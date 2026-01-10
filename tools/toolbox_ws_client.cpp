#include <boost/asio/connect.hpp>
#include <boost/asio/ip/tcp.hpp>
#include <boost/beast/core.hpp>
#include <boost/beast/websocket.hpp>
#include <cstdlib>
#include <iostream>
#include <string>
#include <nlohmann/json.hpp>

namespace beast = boost::beast;
namespace websocket = beast::websocket;
namespace net = boost::asio;
using tcp = net::ip::tcp;
using json = nlohmann::json;

struct WsUrl {
    std::string host;
    std::string port;
    std::string target;
};

static bool parse_ws_url(const std::string& url, WsUrl& out) {
    // Minimal parser for ws://host:port/path
    std::string s = url;
    const std::string prefix = "ws://";
    if (s.rfind(prefix, 0) != 0) return false;
    s = s.substr(prefix.size());

    std::string hostport;
    auto slash = s.find('/');
    if (slash == std::string::npos) {
        hostport = s;
        out.target = "/";
    } else {
        hostport = s.substr(0, slash);
        out.target = s.substr(slash);
        if (out.target.empty()) out.target = "/";
    }

    auto colon = hostport.find(':');
    if (colon == std::string::npos) {
        out.host = hostport;
        out.port = "80";
    } else {
        out.host = hostport.substr(0, colon);
        out.port = hostport.substr(colon + 1);
        if (out.port.empty()) out.port = "80";
    }

    return !out.host.empty();
}

static std::string random_id() {
    // Deterministic enough for demo usage.
    static uint64_t n = 0;
    return "req_" + std::to_string(++n);
}

int main(int argc, char** argv) {
    if (argc < 3) {
        std::cerr << "Usage: " << argv[0] << " ws://host:port/path method [params_json]\n";
        std::cerr << "Example:\n";
        std::cerr << "  " << argv[0] << " ws://localhost:8080/status devices.list\n";
        std::cerr << "  " << argv[0] << " ws://localhost:8080/status device.action '{\"device_id\":\"sim_ln2\",\"action\":{\"set_flow_rate\":2.5}}'\n";
        return 2;
    }

    const std::string ws_url = argv[1];
    const std::string method = argv[2];
    json params = json::object();
    if (argc >= 4) {
        try {
            params = json::parse(argv[3]);
        } catch (const std::exception& e) {
            std::cerr << "Invalid params_json: " << e.what() << "\n";
            return 2;
        }
    }

    WsUrl u;
    if (!parse_ws_url(ws_url, u)) {
        std::cerr << "Invalid ws url (expected ws://host:port/path): " << ws_url << "\n";
        return 2;
    }

    try {
        net::io_context ioc;
        tcp::resolver resolver{ioc};
        websocket::stream<tcp::socket> ws{ioc};

        auto const results = resolver.resolve(u.host, u.port);
        auto ep = net::connect(ws.next_layer(), results);
        ws.set_option(websocket::stream_base::timeout::suggested(beast::role_type::client));
        ws.handshake(u.host + ":" + u.port, u.target);

        const std::string id = random_id();
        json req = {
            {"type", "rpc"},
            {"id", id},
            {"method", method},
            {"params", params},
        };

        ws.write(net::buffer(req.dump()));

        beast::flat_buffer buffer;
        for (;;) {
            buffer.clear();
            ws.read(buffer);
            std::string data = beast::buffers_to_string(buffer.data());
            json msg;
            try {
                msg = json::parse(data);
            } catch (...) {
                continue;
            }

            if (msg.value("type", std::string{}) == "rpc_result" && msg.value("id", std::string{}) == id) {
                std::cout << msg.dump(2) << std::endl;
                break;
            }
        }

        beast::error_code ec;
        ws.close(websocket::close_code::normal, ec);
        return 0;

    } catch (const std::exception& e) {
        std::cerr << "Error: " << e.what() << "\n";
        return 1;
    }
}
