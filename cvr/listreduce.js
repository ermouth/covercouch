/**
 * CoverCouch 0.1.5 _list and reduce emulator
 * Created by ermouth on 04.02.15.
 *
 * sum function implementation is taken from pouchdb/mapreduce
 *
 */


module.exports = function (cvr) {

    var isA = Object.isArray,
        isB = Object.isBoolean,
        isS = Object.isString,
        isO = Object.isObject,
        isN = Object.isNumber,
        isR = Object.isRegExp,
        isF = Object.isFunction;

    var lr,
        builtin = {
            _sum: function (keys, values) {
                return sum(values);
            },

            _count: function (keys, values) {
                return values.length;
            },

            _stats: function (keys, values) {
                function sumsqr(values) {
                    var _sumsqr = 0;
                    for (var i = 0, len = values.length; i < len; i++) {
                        var num = values[i];
                        _sumsqr += (num * num);
                    }
                    return _sumsqr;
                }
                return {
                    sum     : sum(values),
                    min     : Math.min.apply(null, values),
                    max     : Math.max.apply(null, values),
                    count   : values.length,
                    sumsqr : sumsqr(values)
                };
            }
        };

    lr = {
        reduce: function (req, rows) {
            var i,
                idx = {},
                ilist={},
                keys = [],
                group = null,
                result = {rows:[]},
                dbv = cvr.db[req.params.db],
                ddoc = dbv.ddoc['_design/'+(req.params.ddoc2||req.params.ddoc)],
                view = ddoc.views[req.params.view],
                reduce  = view._reduce;
            if (!reduce) {
                _prepareView(view);
                reduce  = view._reduce;
            }

            if (req.body && req.body.keys) group = 999;
            else if (req.query.group_level) group = (+req.query.group_level)||999;
            else if (req.query.group) group = 999;

            // prepare keys and values sets
            rows.forEach(function(e){
                var hash, key = null;
                if (group) {
                   if (isA(e.key)) key = e.key.to(group);
                   else key = e.key;
                }
                hash = "x"+cvr.lib.crc2(key);
                if (!ilist[hash]) {
                    ilist[hash] = {
                        key:key,
                        keys:[],
                        values:[]
                    };
                    keys.push(hash);
                }
                ilist[hash].keys.push([group?key: e.key, e.id]);
                ilist[hash].values.push(e.value);
            });

            // run reduce
            keys.forEach(function(hash){
                var set = ilist[hash],
                    row = {key:set.key, value:null};
                try {
                    row.value = reduce(set.keys, set.values);
                }catch(e){}
                result.rows.push(row);
            });

            return result;

        },
        list: function (req, viewRes) {
            var m = req.method,
                ptr= 0,
                rows=viewRes.rows,
                dbv = cvr.db[req.params.db],
                ddoc = dbv.ddoc['_design/'+(req.params.ddoc2||req.params.ddoc)],
                r = {
                    body:/^(HEAD|DELETE)$/.test(m)?'':(m=="POST"?JSON.stringify(req.body):'undefined'),
                    cookie:req.cookies,
                    headers:req.headers,
                    id:null,
                    info:req.dbInfo||{},
                    method:req.method,
                    raw_path:req.url,
                    peer:req.ip,
                    query:req.query,
                    requested_path:req.url.split("/").compact(true),
                    path:req.path.split("/").compact(true),
                    secObj:req.secObj||{},
                    userCtx:Object.merge({db:req.params.db},cvr.user[req.session.user]._userCtx,true),
                    uuid:req.uuid||''
                },
                result = {
                    code:200,
                    headers:{
                        'content-type':'text/plain; charset=utf-8'
                    },
                    body:'',
                    ready:false
                },
                fn;
            function _getRow(){
                if (result.ready) return null;
                if (rows[ptr])  {
                    return rows[ptr++];
                }
                return null;
            }
            function _send(a) {
                if (result.ready) return;
                if (isS(a)) result.body+= (a+'');
                else if (isO(a) && a.stop) {
                    result.ready = true;
                }
            }
            function _start(a) {
                if (isS(a)) result.body+= a.toString();
                else if (isO(a)) {
                    Object.merge(result, Object.select(a,['code','headers','body']), true);
                }
            }
            fn = _prepareList(ddoc, req.params.list);
            if (fn) {
                // Apply context
                fn = fn(_start,_getRow,_send);
                try{
                    fn (Object.reject(viewRes, 'rows'), r);
                } catch(e){
                    result.code = 500;
                    result.body = JSON.stringify({
                        error:'render_error',
                        reason:e.message||e
                    });
                    result.headers={
                        'content-type':'text/plain; charset=utf-8'
                    };
                }
                result.ready = true;
            }
            return result;
        }

    };

    return cvr.Sandbox = lr;


    //----------------------------

    function _prepareView(view) {
        var fsrc, fn;
        if (isF(view.reduce)) fsrc = view.reduce;
        else if (isS(view.reduce) && /^_(sum|count|stats)$/.test(view.reduce.trim())) {
            fsrc = builtin[view.reduce];
        }
        if (fsrc) {
            fn = new Function ('sum', 'isArray', 'log', 'toJSON', 'return ('+fsrc.toString()+');');
            view._reduce = fn(sum, isA, cvr.log, JSON.stringify);
            fn = null;
        }
        else view._reduce = function(){return null;}
    }

    //----------------------------

    function _prepareList(ddoc, listfn) {
        if (!ddoc) return null;
        var fsrc,fn;
        if (!ddoc._list) ddoc._list={};

        if (ddoc._list[listfn]) return ddoc._list[listfn];

        if (ddoc.lists && isF(ddoc.lists[listfn])) {
            fsrc = ddoc.lists[listfn];
            fn = new Function(
                'start','getRow','send', 'sum', 'isArray', 'log', 'toJSON',
                'return ('+fsrc.toString()+');'
            );
            ddoc._list[listfn] = fn.fill(void 0, void 0, void 0, sum, isA, cvr.log, JSON.stringify);
            return ddoc._list[listfn];
        }
        return null;
    }

    //----------------------------

    function sum(values) {
        var result = 0;
        for (var i = 0, len = values.length; i < len; i++) {
            var num = values[i];
            if (typeof num !== 'number') {
                if (Array.isArray(num)) {
                    // lists of numbers are also allowed, sum them separately
                    result = typeof result === 'number' ? [result] : result;
                    for (var j = 0, jLen = num.length; j < jLen; j++) {
                        var jNum = num[j];
                        if (typeof jNum !== 'number') {
                            throw ('_sum error');
                        } else if (typeof result[j] === 'undefined') {
                            result.push(jNum);
                        } else {
                            result[j] += jNum;
                        }
                    }
                } else { // not array/number
                    throw ('_sum error');
                }
            } else if (typeof result === 'number') {
                result += num;
            } else { // add number to array
                result[0] += num;
            }
        }
        return result;
    }

}