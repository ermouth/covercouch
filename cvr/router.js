/**
 * CoverCouch 0.1.5 router middleware functions
 * Created by ermouth on 18.01.15.
 */


module.exports = function (R, cvr) {

    var i,
        es = cvr.Estream,
        routes = require('./restmap')(cvr),
        conf = cvr.config,
        trimPipe = conf.couch.maxIdLength * 1 + 100,
        couch = conf.couch.url,
        Q = cvr.Q,
        isA = Object.isArray,
        isB = Object.isBoolean,
        isS = Object.isString,
        isO = Object.isObject,
        isN = Object.isNumber,
        isR = Object.isRegExp,
        isF = Object.isFunction;

    var actors = {


        // ====== Prechecks, parsers and early guards ======

        db: function (req, res, next) {

            // Checks if principal has permissions
            // to access bucket and particular method.
            // Detects if request has rangekeys.
            // Caches bucket ACL and ddocs if they are not cached.

            var db = (req.params || {}).db,
                u = cvr.user[req.session.user],
                m = req.method,
                dbv;
            if (!db) next();
            else {
                if (dbv = cvr.db[db]) {
                    if (!cvr.db[db].cached) cvr.Couch.cacheDb(db).then(_check);
                    else _check();
                }
                else _fail(req, res, {error: "not_found", reason: "no_db_file"}, 404);
            }
            return;

            // - - - - - - - - - - - - - -

            function _check() {

                //Can user see this bucket?

                var ok = cvr.ACL.db(req.session, db);
                if (ok == 2) actors.pipe(req, res);
                else if (ok == 1) _restrict();
                else _fail(req, res, {error: "not_found", reason: "ACL"}, 404);
            }

            function _restrict() {

                // Can user exec method and fn requested?

                if (!dbv.restricted || !dbv._restrict[req.method]) _isLong();
                else {
                    var acl = null,
                        allow = false;
                    rules = dbv._restrict[req.method],
                        url = req.url.from(req.params.db.length + 1);
                    rules.forEach(function (e) {
                        if (e[0].test(url)) {
                            if (!acl) acl = {};
                            Object.merge(acl, e[1]);
                        }
                    });
                    if (!acl) return _isLong();
                    u._acl.forEach(function (e) {
                        if (acl[e]) allow = true;
                    });
                    if (!allow) _fail(req, res, {error: "forbidden", reason: "Method restricted."}, 403);
                    else _isLong();
                }
            }

            function _isLong() {

                // Request is long?

                var q = req.query || {};
                if (m === "GET" || m === "POST") {
                    req.isLong = !(
                        (req.body && req.body.keys)
                        ||
                        (q.startkey !== undefined && q.endkey !== undefined )
                        ||
                        q.key !== undefined
                        )
                        ||
                        (q.include_docs !== undefined && q.attachments !== undefined );
                }
                next();
            }
        },

        doc: function (req, res, next) {
            // acl-controls doc and op over it
            var mt = req.method,
                m = ({
                    GET: '_r',
                    PUT: '_w',
                    DELETE: '_d',
                    HEAD: '_r'
                })[mt],
                ispost = mt == "POST",
                db = req.params.db,
                id = req.params.id,
                acl;

            if (ispost) {

                // Special case – can be new doc, _update or _show call.
                // Note we validate _update request as READ, not WRITE, cause
                // doc modifications using _update functions are assumed safe.
                // Real-world scenario – user may have read permissions
                // and rights to update several doc fields with _update fn.

                if (id) m = '_r'; //_show or _update
                else {
                    m = '_w';
                    id = req.body._id;
                }
            }

            if (!req.params.ddoc && /^[^\?]\/_design\//.test(req.url)) id = '_design/' + id;

            acl = cvr.ACL.doc(req.session, db, id);
            if (acl[m]) next();
            else {
                _fail(req, res, {
                    error: m != '_r' ? "forbidden" : "not_found",
                    reason: "ACL"
                }, m != '_r' ? 403 : 404);
            }
        },

        body: function (req, res, next) {
            // bodyParser
            try {
                cvr.bodyParser({limit: conf.server.maxpost})(req, res, next);
            } catch (e) {
                _fail(req, res, {error: "bad_request", reason: 'Invalid format.'}, 400);
            }
        },

        dbinfo : function (req, res, next){

            // Mounts different db info to req,
            // needed for _list emulation

            var db = req.params.db,
                done = (function(){  next(); }).after(3);

            cvr.nano.db.get(db, function(e, r){
                if (!e) req.dbInfo = r;
                done();
            });

            cvr.nano.request({ db:db,  path:'/_security' }, function(e, r){
                if (!e) req.secObj = r;
                done();
            });

            cvr.nano.request({ path:'_uuids'  }, function(e, r){
                if (!e) req.uuid = r.uuids[0];
                done();
            });
        },


        // ====== Terminal functions ======

        error: function (err, req, res, next) {
            _fail(req, res, {
                error: err.status == 400 ? "bad_request" : "error",
                reason: err.message || 'Invalid request.'
            }, err.status || 400);
        },


        bulk: function (req, res) {
            // saves multiple docs
            var o = req.body,
                d = o.docs,
                r0 = [], r1 = [],
                atomic = req.body ? req.body.all_or_nothing + '' == 'true' : false,
                errs = false,
                p = _gen(req, {body: Object.reject(o, 'docs')}, true);

            if (isA(d) && d.length) {

                d.forEach(function (e) {
                    if (!isO(e)) {
                        r1.push({error: 'error', reason: 'Invalid object.'});
                        errs = true;
                    }
                    else if (!e._id) {
                        r0.push(e);
                        r1.push(null);
                    }
                    else if (cvr.ACL.doc(req.session, req.params.db, e._id)[e._deleted ? '_d' : '_w']) {
                        r0.push(e);
                        r1.push(null);
                    }
                    else {
                        r1.push({id: e._id, error: 'forbidden', reason: 'ACL'});
                        errs = true;
                    }
                });
                p.body.docs = r0;

                // Now we ready to request Couch
                // to save subset of elts that may be allowed

                if (atomic && errs) {
                    _fail(req, res, { error: "forbidden", reason: "ACL rejected transaction." }, 403);
                }
                else if (r0.length) cvr.Request(p).then(function (data) {
                    var a, ctr = 0;
                    try {
                        a = isS(data[1]) ? JSON.parse(data[1]) : data[1];
                    } catch (e) {
                    }
                    if (isA(a)) {
                        a.forEach(function (e) {
                            if (!ctr && r1[0] == null) {
                                r1[0] = e;
                            } else {
                                while (r1[ctr] != null && ctr <= r1.length) {
                                    ctr++;
                                }
                                if (ctr < r1.length) r1[ctr] = e;
                            }
                        });
                        _send(req, res, [data[0], r1.compact(true)]);
                        a = r0 = void 0;
                    }
                    else _send(req, res, data);
                });
                else _sendRaw(req, res, r1, 200);
            }
            else actors.pipe(req, res);

        },


        session: function (req, res) {
            // Gets session
            if (req.method == "DELETE" && req.session.id) {
                cvr.session[req.session.id] = null;
            }
            req.pipe(cvr.request({
                url: couch + req.url,
                headers: req.h
            }))
                .pipe(res);
        },


        auth: function (req, res) {
            // Authorize user
            var p;
            if (
                !req.body
                || !isS(req.body.name)
                || !isS(req.body.password)
                ) {
                _fail(req, res, { error: "unauthorized", reason: "Invalid request." }, 401);
            }
            else {
                var u = cvr.user[req.body.name];
                if (!u || u.name == '_anonymous' || u.inactive) {
                    _fail(req, res, { error: "unauthorized", reason: "Invalid login or password." }, 401);
                } else {
                    p = _gen(req, {method: "POST"});
                    cvr.Request(p).done(function (data) {
                        // We do not memoize session now
                        _send(req, res, data);
                    });
                }
            }
        },


        admin: function (req, res) {
            // Rejects request if not admin,
            // pipes if admin
            var u = cvr.user[req.session.user];
            if (u.admin) actors.pipe(req, res);
            else _fail(req, res);
        },


        pipe: function (req, res) {
            // Pipes request through
            var p = {
                url: couch + req.url,
                headers: req.h
            };
            //If we have no body parsed, pipe request
            if (!req.body) req.pipe(cvr.request(p)).pipe(res);
            else {
                // Make request and send result
                p = _gen(req, {});
                cvr.Request(p).done(function (data) {
                    _send(req, res, data);
                });
            }
        },


        dblist: function (req, res) {
            // Get list of all dbs,
            // first checks accesibility of each
            // and restrictions in _design/acl for
            // user

            cvr.Request(_gen(req), {}, true).done(function (data) {
                // We do not memoize session
                // until next request with cookie
                var a, dbs = [];
                try {
                    a = isS(data[1]) ? JSON.parse(data[1]) : data[1];
                } catch (e) {
                }
                if (isA(a)) {
                    a.forEach(function (db) {
                        if (cvr.ACL.db(req.session, db)) dbs.push(db);
                    })
                }
                _send(req, res, [data[0], dbs]);
            });
        },

        changes: function (req, res) {
            // Pipes filtered changes feed
            var db = req.params.db,
                m = "no",
                seq = {},
                ctr = 0,
                prev = null,
                json = false,
                p = _gen(req);

            // detect method
            if (/^(normal|longpoll|continuous|eventsource)$/.test(req.query.feed)) m = req.query.feed.to(2);
            if (req.query.attachments && req.query.include_docs && m == "no") m = "lo";

            json = /^[nl]/.test(m);

            req.pipe(cvr.request(p))
                .pipe(es.split())
                .pipe(es.map(function (data, done) {
                    var id, ok = false, dseq;
                    ctr += 1;
                    if (!data.length) {
                        ok = true;
                        _fin()
                    }
                    else {
                        if (json) {
                            if (ctr == 1 || data.to(11) === '"last_seq":') ok = true;
                            else if (data.to(2) === '],') ok = true;
                        }
                        else if (m == "ev" && data.to(3) === 'id:') {
                            if (seq[data.from(3).trim()]) ok = true;
                            else ok = false;
                        }
                        else if (m == "co" && data.to(11) == '{"last_seq"') ok = true;
                        // parse id
                        if (!ok) {
                            id = (data.to(trimPipe).match(/^(data:)?\{[^\{]*"id":"(.+?)","/) || []).last();

                            if (id) {
                                dseq = (data.to(50).match(/^(data:)?\{[^\{]*"seq":(\d+),"/) || []).last();
                                if (dseq) {
                                    dseq = +dseq;
                                    if (cvr.db[db].acl[id] && cvr.db[db].acl[id].s >= dseq) {

                                        ok = !!cvr.ACL.doc(req.session, req.params.db, id)._r;
                                        _fin(dseq);
                                    }
                                    else {
                                        // read ACL async
                                        cvr.ACL.load(db, id, dseq)
                                            .then(
                                            function () {
                                                ok = !!cvr.ACL.doc(req.session, req.params.db, id)._r;
                                                _fin(dseq);
                                            },
                                            function () {
                                                ok = false;
                                                _fin();
                                            }
                                        );
                                    }
                                } else _fin();
                            } else _fin();
                        } else _fin();
                    }
                    return;

                    function _fin(dseq) {
                        if (ok) {
                            if (dseq) seq[dseq] = true;
                            done(null, data + '\n');
                        }
                        else {
                            if (dseq) seq[dseq] = false;
                            done();
                        }
                    }
                }))
                .pipe(es.split())
                .pipe(es.mapSync(function (data) {
                    // Manipulations to trim off last comma before ]}
                    // if it appears due to ACL-dropped rows.
                    var tosend = '';
                    if (!json) return data;
                    if (data.to(2) === '],') {
                        if (prev.last() === ',') tosend = prev.to(-1);
                        else tosend = prev;
                        tosend += '\n' + data;
                        prev = '';
                    }
                    else {
                        tosend = prev;
                        prev = data;
                    }

                    if (null !== tosend) return tosend + '\n';
                    else return void 0;
                }))
                .pipe(res);
        },


        list: function(req, res){
            // _list implemetation, 3rd edition
            var db = req.params.db,
                dbv = cvr.db[db],
                path = req.params,
                jsopts={}, opts,
                rows=[],
                resobj={},
                viewResult = {offset:0, total_rows:0},
                isReduce = (
                    cvr.lib.getref(dbv.viewnames, (path.ddoc2||path.ddoc)+'.'+path.view) == 'reduce'
                    && req.query.reduce != 'false'
                );

            if (isO(req.query)) jsopts = _unjsonQuery(req.query);

            opts = Object.merge(
                Object.reject(jsopts, ['attachments', 'include_docs', 'format','reduce','group','group_level']),
                    req.body && isA(req.body.keys) ? {keys: req.body.keys} : {},
                true
            );
            opts.reduce = false;

            dbv.nano.view(path.ddoc, path.view, opts, _list)
            .pipe(es.split())
            .pipe(es.mapSync(function (data) {
                var id, d;
                if (data.length<100 && /^\{[^\{]*"offset":[^\{]*\[$/.test(data)) {
                    d = JSON.parse(data+']}');
                    viewResult.offset = d.offset;
                    viewResult.total_rows = d.total_rows;
                }
                // detect id
                id = (data.to(trimPipe).match(/^\{[^\{]*"id":"(.+?)","/) || []).last();
                if (id && cvr.ACL.doc(req.session, db, id)._r) {
                    // detect key, need to parse JSON
                    try {
                        d = JSON.parse(data.last() == ',' ? data.to(-1) : data);
                    } catch (e) {}

                    if (undefined !== d) rows.push(d);
                }
                return '';
            }));

            //----------------------------

            function _list(err){
                if (!err) {
                    if (isReduce) viewResult =  cvr.Sandbox.reduce(req,rows);
                    else viewResult.rows = rows;

                    resobj = cvr.Sandbox.list(req, viewResult);

                    // convert vobj to valid response
                    res.status(resobj.code || 200);
                    res.set(resobj.headers);
                    res.send(resobj.body);
                }
                else _fail(req,res,{error:"error", reason:err.reason}, err.statusCode)
            }
        },


        rows: function (req, res) {
            // Get and acl-filter rows
            var db = req.params.db,
                dbv = cvr.db[db],
                path = req.params,
                jsopts, opts,
                rows=[],
                p = _gen(req, {}, true);

            if (
                cvr.lib.getref(dbv.viewnames, path.ddoc+'.'+path.view) == 'reduce'
                && req.query.reduce != 'false'
            ) {

                // We have reduce

                if (isO(req.query)) jsopts = _unjsonQuery(req.query);

                opts = Object.merge(
                    Object.reject(jsopts, ['attachments', 'include_docs', 'format','reduce','group','group_level']),
                    req.body && isA(req.body.keys) ? {keys: req.body.keys} : {},
                    true
                );
                opts.reduce = false;

                dbv.nano.view(path.ddoc, path.view, opts, _reduce)
                .pipe(es.split())
                .pipe(es.mapSync(function (data) {
                    var id, d;

                    // detect id
                    id = (data.to(trimPipe).match(/^\{[^\{]*"id":"(.+?)","/) || []).last();
                    if (id && cvr.ACL.doc(req.session, db, id)._r) {
                        // detect key, need to parse JSON
                        try {
                            d = JSON.parse(data.last() == ',' ? data.to(-1) : data);
                        } catch (e) {}

                        if (undefined !== d) rows.push(d);
                    }
                    return '';
                }));

            } else {

                // No reduce

                if (req.isLong) {
                    // Potentially long request,
                    // use pipe ACL (no compression)
                    var prev = null;
                    req.pipe(cvr.request(p))
                    .pipe(es.split())
                    .pipe(es.mapSync(function (data) {
                        var end = ( ']}' === data ),
                            id, ok = false,
                            tosend = '';

                        if (!data.length || end || data.last() === '[') ok = true;
                        else {
                            // try to detect id without parsing json
                            id = (data.to(trimPipe).match(/^(data:)?\{[^\{]*"id":"(.+?)","/) || []).last();
                            if (id) ok = !!cvr.ACL.doc(req.session, req.params.db, id)._r;
                            else ok = true;
                        }

                        if (ok) {
                            // Manipulations to trim off last comma before ]}
                            if (end) {
                                if (prev.last() === ',') tosend = prev.to(-1);
                                else tosend = prev;
                                tosend += '\n' + data;
                                prev = '';
                            }
                            else {
                                tosend = prev;
                                prev = data;
                            }
                        }

                        if (ok && null !== tosend) return tosend + '\n';
                        else return void 0;
                    }))
                    .pipe(res);
                }

                else {
                    // If request has no include_docs & attachments,
                    // and have some range keys,
                    // use full-fetch and one-time check.
                    // Employs compression and generally faster then pipe.
                    cvr.Request(p).done(function (data) {
                        var d, r;
                        try {
                            d = isS(data[1]) ? JSON.parse(data[1]) : data[1];
                        } catch (e) {
                        }
                        if (d && d.rows) {
                            r = {total_rows: d.total_rows, offset: (d).offset || 0, rows: []}
                            r.rows = cvr.ACL.rows(
                                req.session,
                                db,
                                d.rows,
                                '_r',
                                    req.method == "POST" && p.body.keys
                            );
                            _send(req, res, [data[0], r]);
                            d = r = null;
                        }
                        else _send(req, res, data);
                    });
                }
            }

            //----------------------------

            function _reduce(err){
                if (!err) {
                    res.set(req.h);
                    res.send(cvr.Sandbox.reduce(req,rows));
                }
                else _fail(req,res,{error:"error", reason:err.reason}, err.statusCode)
            }
        },


        revs: function (req, res) {
            // get and acl-filter revs-diff or missing-revs
            var db = req.params.db;
            cvr.Request(_gen(req, { body: cvr.ACL.object(req.session, db, req.body, '_r') }, true))
                .done(function (data) {
                    _send(req, res, data);
                });
        },


        test: function (req, res) {
            res.send({path: req.path, params: req.params, query: req.query, body: req.body, headers:req.headers});
        }
    };


    // Build router

    for (i in routes) {
        routes[i].forEach(function (e) {
            var args = [e.path].add(e.ops.map(function (op) {
                return actors[op];
            })).add(actors.error);
            R[i].apply(R, args);
        })
    }

    return R;


    // #####  SERVICE FNS ########

    function _jsonQuery(obj) {
        var i, r = isA(obj)?[]:{};
        for ( i in obj) {
            if (/^(start\-?key|end\-?key|key)$/.test(i))  r[i] = JSON.stringify(obj[i]);
            else r[i] = obj[i];
        }
        return r;
    }


    //----------------------------

    function _unjsonQuery(obj0) {
        var i, tmp, jsopts = {}, obj = obj0||{};
        for (i in obj) {
            tmp = void 0;
            if (/^(start\-?key|end\-?key|key)$/.test(i)) {
                try {
                    tmp = JSON.parse(req.query[i]);
                } catch (e) {}
                if (tmp!==void 0) jsopts[i] = tmp;
            }
            else jsopts[i] = obj[i];
        }
        return jsopts;
    }


    //----------------------------

    function _gen(req, obj, forceJSON) {
        // Generates obj for request.js
        var src = isO(obj) ? obj : {},
            p = {
                url: couch + req.url,
                headers: req.h,
                method: req.method
            };

        Object.merge(p, src, true);

        if (isO(req.body) && p.method == "POST") {
            p.body = p.body || req.body;
            p.json = true;
            p.headers['content-type'] = 'application/json';
        }

        if (forceJSON) {
            p.headers['content-type'] = 'application/json';
            p.headers.accept = 'application/json';
        }

        return p;

    }

    //----------------------------

    function _fail(req, res, obj, code) {
        _sendRaw(req, res, obj || {
            error: "forbidden",
            reason: "Access denied."
        }, code || 403);
    }

    //----------------------------

    function _sendRaw(req, res, data, code) {
        res.set(req.h);
        res.status(code || 200).send(data);
    }

    //----------------------------

    function _send(req, res, arr) {
        var d = arr[0];
        res.set({
            "Server": d.headers.server,
            "Content-Type": "application/json; charset=utf-8",
            "Date": d.headers.date,
            "Cache-Control": d.headers["cache-control"]
        });
        if (d.headers["set-cookie"]) {
            res.set({"Set-Cookie": d.headers["set-cookie"]});
        }
        else if (req.cookies && req.cookies.AuthSession) {
            res.cookie("AuthSession", req.cookies.AuthSession);
        }
        res.status(d.statusCode || 200);
        res.send(arr[1]);
    }
}
