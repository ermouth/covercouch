/**
 * CoverCouch 0.1.4 configuration
 * Created by ermouth on 18.01.15.
 */

module.exports = function (runtime) {
    return {

        server: {
            mount: "/",                 // Mount path, no trailing slash
            port: 8000,                 // Port
            maxpost: 50 * 1024 * 1024,  // Max size of POST request

            rater: {                    // Request rate locker
                all: {                  // Total requests limit
                    interval: 1,        // Seconds, collect interval
                    limit: 100          // Max requests per interval
                },
                ip: {                   // Per-ip requests limit
                    interval: 10,
                    limit: 100
                }
            }
        },

        couch: {
            url: "http://127.0.0.1:5984",                   // Couch URL
            nano: "http://login:pass@127.0.0.1:5984",       // Couch URL with admin login:pass
            users: "_users",                                // Users bucket
            maxIdLength: 200,           // Max _id length
            preload: [                  // Buckets to preload and to insert acl ddoc if none
                // "sales","dev"
            ]
        },

        workers: {
            "count": 1,                 // Total threads
            "reloadAt": 4,              // Hour all threads are restarted
            "reloadOverlap": 30e3,      // Gap between restarts of simultaneous threads
            "killDelay": 2e3            // Delay between shutdown msg to worker and kill, ms
        },

        // CORS headers
        headers: {
            "Access-Control-Allow-Credentials": true,
            "Access-Control-Expose-Headers": "Content-Type, Server",
            "Access-Control-Allow-Headers": "Content-Type, Server, Authorization",
            "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS,HEAD",
            "Access-Control-Max-Age": "86400",
            "X-Powered-By": "CoverCouch 0.1.0"
        },

        // CORS domains, like "http://xxx.xxx": true
        origins: {}
    }
}