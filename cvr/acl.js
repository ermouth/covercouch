/**
 * CoverCouch 0.1 ACL-related functions
 * Created by ermouth on 19.01.15.
 */
module.exports = function (cvr) {

	var Q = cvr.Q,
		pending={},
		isA = Object.isArray,
		isB = Object.isBoolean,
		isS = Object.isString,
		isO = Object.isObject,
		isN = Object.isNumber,
		isR = Object.isRegExp,
		isF = Object.isFunction;

	function _getAcl(u, dbv, id0) {
		// assume acl view is loaded
		var id=id0 || "",
			acl = {
				_r:true,
				_w:true,
				_d:true
			},
			dacl;

		if (u.admin) return acl;

		if (/^_design\//.test(id)) acl._w = acl._d = false;

		if (!dbv.noacl && !u.superuser) {
			// check doc...
			var dacl = dbv.acl[id];
			if (dacl) {
				acl._r = acl._w = acl._d = false;
				u._acl.forEach(_setAcl);

				// ...and parent
				if (dacl.p && dbv.acl[dacl.p]) {
					dacl = dbv.acl[dacl.p];
					u._acl.forEach(_setAcl);
				}
			}
		}

		// Apply per-DB rules
		var ddoc = dbv.ddoc['_design/acl'];
		if (ddoc && isO(ddoc.dbacl)) {
			if (!id) acl._r = acl._w = acl._d = false;
			dacl = ddoc.dbacl;
			u._acl.forEach(_setAcl);
		}

		return acl;

		//--------------

		function _setAcl(e) {
			if (!acl._r && dacl._r && dacl._r[e]) acl._r = true;
			if (!acl._w && dacl._w && dacl._w[e]) acl._w = true;
			if (!acl._d && dacl._d && dacl._d[e]) acl._d = true;
		}
	}

	cvr.ACL = {
		_pending:pending, // ACL update requests pending, keys are "dbname docid dbseq"

		load: function(db, id, seq0){
			// return promise that is resolved with acl doc
			// when ACL become up-to-date
			var dbv = cvr.db[db],
				dbc = dbv.nano,
				seq = +seq0,
				key = db+" "+id,
				pi, i, iseq = 0, aclreq;

			if (dbv.acl[id] && +dbv.acl[id].s >= seq) {
				// ACL is up-to-date
				iseq = +dbv.acl[id].s;
				pi=null;
				if (pending[key] && Object.size(pending[key])) {
					// detach promises from repo
					for (i in pending[key]) {
						if (+i <= iseq) {
							pi = pending[key];
							pi.resolve(dbv.acl[id]);
							delete pending[key][i];
						}
					}
					if (pi) {
						return pi.promise;
					}
				}
				pi = Q.defer();
				pi.resolve(dbv.acl[id]);
				return pi.promise;
			}
			else {
				// ACL is not up-to-date
				if (pending[key]) {
					// Check if we already have ACL request
					// to CouchDB pending
					aclreq = null; iseq = 0;
					for (i in pending[key]) {
						if (+i>iseq) {
							aclreq = pending[key][i];
							iseq = +i;
						}
					}
					if (aclreq && iseq>=seq) {
						// return ACL req promise
						//console.log("Cache hit – pending ACL "+key);
						return aclreq.promise;
					}
				}
				// wire new ACL request
				if (!pending[key]) pending[key] = {};
				pending[key][seq] = pi = Q.defer();
				Q.denodeify(dbc.view)("acl","acl",{keys:[id]})
				.then(function(data){
					var r = dbv.acl[id];
					if (data[0].rows && data[0].rows.length) {
						r = dbv.acl[id] = data[0].rows[0].value;
					}
					else if (r) {
						dbv.acl[id].s = seq;
					}
					// Resolve all promises with ACL seq <= reqd one
					if (r) {
						iseq = r.s;
						for (i in pending[key]) {
							if (+i <= iseq) {
								pending[key][i].resolve(r);
								delete pending[key][i];
							}
						}
					} else pi.resolve({_r:{},_d:{},_w:{},p:"",s:seq});

				},
				function(d){
					pi.reject();
				});
				return pi.promise;
			}
		},
		db: function (session, db) {
			var u = cvr.user[session.user],
				dbv = cvr.db[db];
			if (!dbv) return false;
			if (dbv.isforall && dbv.noacl && !dbv.restricted) return 2;
			else {
				if (!dbv.isforall) {
					// we have _design/acl.restrict.* general access rule
					var acl = cvr.db[db].ddoc['_design/acl'].restrict["*"],
						allow = false;
					u._acl.forEach(function(e){if (acl[e]) allow=true;});
					return allow?1:0;
				}
				else return 1;
			}
		},
		doc: function(session, db, id){
			// Sync validator by doc._id,
			// assume acl view is loaded
			// and up-to-date
			var u = cvr.user[session.user],
				dbv = cvr.db[db];
			return _getAcl(u, dbv, id);
		},
		rows: function(session, db, rows, action, preserveDenied){
			// rows-like array mass validator
			var u = cvr.user[session.user],
				dbv = cvr.db[db],
				op = action||"_r",
				r = [];
			rows.forEach(function(e){
				if (_getAcl(u, dbv, e.id)[op]) r.push(e);
				else if (preserveDenied) r.push({id: e.id, error:"not_found"})
			});
			return r;
		},
		object: function(session, db, list, action){
			var i, u = cvr.user[session.user],
				dbv = cvr.db[db],
				op = action||"_r",
				r = {};
			for (i in list) {
				if (_getAcl(u, dbv, i)[op]) r[i]=list[i];
			}
			return r;
		},
		unwind: function(a){
			// converts ["user1","r-users","u-user2"]
			// to unified {"u-user1": 1, "r-users": 1, "u-user2": 1}
			if (!isA(a) || !a.length) return {};
			var r = {};
			a.forEach(function(e){
				if (isS(e) && e) {
					if (/^[ru]-.+/.test(e)) r[e]=1;
					else r['u-'+e] = 1;
				}
			});
			return r;
		}

	};

}