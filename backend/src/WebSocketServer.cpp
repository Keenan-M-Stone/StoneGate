#include "WebSocketServer.hpp"
#include "DescriptorProtocol.hpp"
#include "DeviceRegistry.hpp"
#include "simulator/SimulatedDevice.hpp"
#include <iostream>
#include <chrono>
// Boost.Beast / Asio for WebSocket
#include <boost/beast/core.hpp>
#include <boost/beast/websocket.hpp>
#include <boost/asio/ip/tcp.hpp>
#include <boost/asio/strand.hpp>
#include <mutex>
#include <set>

namespace beast = boost::beast;         // from <boost/beast.hpp>
namespace http = beast::http;           // not used but conventional
namespace websocket = beast::websocket; // from <boost/beast/websocket.hpp>
namespace asio = boost::asio;           // from <boost/asio.hpp>
using tcp = asio::ip::tcp;              // from <boost/asio/ip/tcp.hpp>

WebSocketServer::WebSocketServer(int p, DeviceRegistry& reg)
: port(p), running(false), registry(reg) {}

// Implementation details hidden behind PIMPL
struct WebSocketServer::Impl {
    asio::io_context ioc;
    tcp::acceptor acceptor;
    std::mutex sessions_m;
    std::set<std::shared_ptr<websocket::stream<tcp::socket>>> sessions;
    Impl(int port): ioc(), acceptor(ioc) {
        boost::system::error_code ec;
        acceptor.open(tcp::v4(), ec);
        if (ec) {
            std::cerr << "acceptor.open failed: " << ec.message() << std::endl;
        }
        acceptor.set_option(asio::socket_base::reuse_address(true), ec);
        if (ec) {
            std::cerr << "set_option failed: " << ec.message() << std::endl;
        }
        acceptor.bind(tcp::endpoint(tcp::v4(), port), ec);
        if (ec) {
            std::cerr << "bind failed: " << ec.message() << std::endl;
        }
        acceptor.listen(asio::socket_base::max_listen_connections, ec);
        if (ec) {
            std::cerr << "listen failed: " << ec.message() << std::endl;
        }
    }

    void add_session(std::shared_ptr<websocket::stream<tcp::socket>> s) {
        {
            std::lock_guard<std::mutex> lk(sessions_m);
            sessions.insert(s);
            std::cerr << "WebSocketServer: client connected (count=" << sessions.size() << ")" << std::endl;
        }
    }
    void remove_session(std::shared_ptr<websocket::stream<tcp::socket>> s) {
        {
            std::lock_guard<std::mutex> lk(sessions_m);
            sessions.erase(s);
            std::cerr << "WebSocketServer: client disconnected (count=" << sessions.size() << ")" << std::endl;
        }
    }
    template<typename Fn>
    void for_each_session(Fn&& fn) {
        std::lock_guard<std::mutex> lk(sessions_m);
        for (auto &s : sessions) fn(s);
    }
};

WebSocketServer::~WebSocketServer() {
    stop();
}

void WebSocketServer::start() {
    if (running) return;
    running = true;
    protocol = std::make_unique<DescriptorProtocol>(registry);

    // initialize impl with port and start event loop
    impl = std::make_shared<Impl>(port);

    event_thread = std::thread([this](){ run_event_loop(); });
    broadcast_thread = std::thread([this](){ broadcast_measurements_loop(); });
}

void WebSocketServer::stop() {
    running = false;
    if (event_thread.joinable()) event_thread.join();
    if (broadcast_thread.joinable()) broadcast_thread.join();
}

void WebSocketServer::run_event_loop() {
    try {
        // Start accepting loop using Boost.Asio/Beast
        auto& ioc = impl->ioc;
        auto& acceptor = impl->acceptor;

        std::function<void()> do_accept;
        do_accept = [&]() {
            auto socket = std::make_shared<tcp::socket>(ioc);
            acceptor.async_accept(*socket, [this, socket, &do_accept](boost::system::error_code ec) {
                if (ec) {
                    if (running) std::cerr << "accept error: " << ec.message() << std::endl;
                } else {
                    // Create a websocket stream and accept the handshake
                    auto ws = std::make_shared<websocket::stream<tcp::socket>>(std::move(*socket));
                    // Accept the websocket handshake
                    ws->async_accept([this, ws](boost::system::error_code ec) {
                        if (ec) {
                            std::cerr << "websocket accept failed: " << ec.message() << std::endl;
                            return;
                        }
                        impl->add_session(ws);
                        // Start a read loop to keep the connection alive and receive control messages
                        auto buffer = std::make_shared<beast::flat_buffer>();
                        auto do_read = std::make_shared<std::function<void()>>();
                        *do_read = [this, ws, buffer, do_read]() {
                            ws->async_read(*buffer, [this, ws, buffer, do_read](boost::system::error_code ec, std::size_t bytes_transferred){
                                if (ec) {
                                    impl->remove_session(ws);
                                    return;
                                }
                                try {
                                    auto data = beast::buffers_to_string(buffer->data());
                                    buffer->consume(buffer->size());
                                    auto j = nlohmann::json::parse(data);
                                    handle_control(j);
                                } catch (...) {}
                                (*do_read)();
                            });
                        };
                        (*do_read)();
                    });
                }
                if (running) do_accept();
            });
        };

        // kickoff accept loop
        do_accept();

        // Run the I/O context until stopped (use non-blocking poll loop)
        while (running) {
            try {
                impl->ioc.poll();
            } catch (const std::exception& e) {
                std::cerr << "I/O context error: " << e.what() << std::endl;
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(50));
        }

        // cleanly close sessions
        impl->for_each_session([&](std::shared_ptr<websocket::stream<tcp::socket>> s){
            boost::system::error_code ec;
            s->close(websocket::close_code::normal, ec);
        });

    } catch (const std::exception& e) {
        std::cerr << "run_event_loop exception: " << e.what() << std::endl;
    }
}

void WebSocketServer::handle_control(const nlohmann::json& msg) {
    try {
        if (msg.contains("cmd") && msg["cmd"] == "reload_overrides") {
            bool any = false;
            registry.for_each_device([&](std::shared_ptr<Device> d){
                auto sd = std::dynamic_pointer_cast<SimulatedDevice>(d);
                if (sd) {
                    if (sd->trigger_reload_overrides()) any = true;
                }
            });
            std::cout << "WebSocketServer: reload_overrides triggered via control (any=" << any << ")\n";
        }
    } catch (const std::exception& e) {
        std::cerr << "handle_control error: " << e.what() << std::endl;
    }
}

void WebSocketServer::broadcast_measurements_loop() {
    while (running) {
        try {
            auto msgj = protocol->build_measurement_update();
            auto payload = msgj.dump();
            // send payload to all sessions
            if (impl) {
                impl->for_each_session([&](std::shared_ptr<websocket::stream<tcp::socket>> s){
                    // perform async write on the connection's executor
                    asio::post(s->get_executor(), [s, payload]() {
                        boost::system::error_code ec;
                        s->write(asio::buffer(payload), ec);
                        if (ec) {
                            // ignore write errors here; session read loop will clean up
                        }
                    });
                });
            }
        } catch (const std::exception& e) {
            std::cerr << "broadcast error: " << e.what() << std::endl;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(500));
    }
}