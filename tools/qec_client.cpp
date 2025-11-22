// Minimal QEC client example using libcurl + nlohmann::json
// Usage: ./qec_client [server_url]
// Example: ./qec_client http://localhost:5001

#include <curl/curl.h>
#include <nlohmann/json.hpp>
#include <iostream>
#include <string>
#include <thread>
#include <chrono>

using json = nlohmann::json;

static size_t write_cb(void* ptr, size_t size, size_t nmemb, void* userdata) {
    std::string* resp = static_cast<std::string*>(userdata);
    resp->append(static_cast<char*>(ptr), size * nmemb);
    return size * nmemb;
}

struct HttpResult { long code; std::string body; };

static HttpResult http_post(const std::string& url, const std::string& payload) {
    CURL* curl = curl_easy_init();
    if (!curl) return {0, ""};
    std::string response;
    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, "Content-Type: application/json");

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_POST, 1L);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, payload.c_str());
    curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, static_cast<long>(payload.size()));
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_cb);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);

    CURLcode res = curl_easy_perform(curl);
    long code = 0;
    if (res == CURLE_OK) curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &code);

    // clear the header option on the easy handle before freeing the list
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, nullptr);
    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    return {code, response};
}

static HttpResult http_get(const std::string& url) {
    CURL* curl = curl_easy_init();
    if (!curl) return {0, ""};
    std::string response;
    curl_easy_setopt(curl, CURLOPT_HTTPGET, 1L);
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_cb);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);

    CURLcode res = curl_easy_perform(curl);
    long code = 0;
    if (res == CURLE_OK) curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &code);
    curl_easy_cleanup(curl);
    return {code, response};
}

int main(int argc, char** argv) {
    std::string base = "http://localhost:5001";
    if (argc > 1) base = argv[1];

    try {
        // Build a simple QEC submit payload
        json payload = {
            {"code", "repetition"},
            {"measurements", json::array({ { {"qubit", 0}, {"basis","Z"}, {"round",0}, {"value",1} } }) }
        };

        auto post_res = http_post(base + "/api/qec/submit", payload.dump());
        if (post_res.code < 200 || post_res.code >= 300) {
            std::cerr << "POST failed (" << post_res.code << "): " << post_res.body << std::endl;
            return 2;
        }

        json resp = json::parse(post_res.body);
        std::string job_id = resp.value("job_id", "");
        std::cout << "Submitted job: " << job_id << std::endl;

        if (job_id.empty()) {
            std::cerr << "No job_id returned" << std::endl;
            return 3;
        }

        // poll status
        std::string status_url = base + "/api/qec/status/" + job_id;
        std::string result_url = base + "/api/qec/result/" + job_id;

        for (int i = 0; i < 60; ++i) {
            auto st = http_get(status_url);
            if (st.code >= 200 && st.code < 300) {
                try {
                    auto j = json::parse(st.body);
                    std::string status = j.value("status", "");
                    double progress = j.value("progress", 0.0);
                    std::cout << "Status: " << status << " (" << progress << ")\r" << std::flush;
                    if (status == "done" || status == "completed") {
                        std::cout << std::endl << "Fetching result..." << std::endl;
                        break;
                    }
                } catch (...) {
                    // ignore parse errors
                }
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(250));
        }

        auto final = http_get(result_url);
        if (final.code >= 200 && final.code < 300) {
            try {
                auto jr = json::parse(final.body);
                std::cout << "Result:\n" << jr.dump(2) << std::endl;
            } catch (...) {
                std::cout << "Result (raw): " << final.body << std::endl;
            }
        } else {
            std::cerr << "Failed to fetch result: " << final.code << " " << final.body << std::endl;
        }

    } catch (const std::exception& e) {
        std::cerr << "Exception: " << e.what() << std::endl;
        return 4;
    }

    // nothing to cleanup here (each helper cleans up its own CURL handle)
    return 0;
}
