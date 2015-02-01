/**
 * CoverCouch 0.1 default _design/acl
 * Created by ermouth on 21.01.15.
 */


module.exports = function(){

	// To make JSON, pasteable in CouchDB as new doc,
	// use JSON editor http://cloudwall.me/etc/json-editor.html –
	// just paste raw ddoc definition from below.

	var ddoc = {
		_id:"_design/acl",
		options:{
			local_seq:true,
			include_design:true
		},

		type:"ddoc",
		stamp:Date.now(),
		version:"0.1.0",

		acl:[],
		/*
		restrict:{
			"*":[]
		},
		dbacl:{
			_r:[],
			_w:[],
			_d:[]
		},
		*/
		views:{
			acl:{
				map: function(doc) {

					// Map fn that generates ACL index

					var r = {
							s:doc._local_seq,
							p:"",
							_r:{},
							_w:{},
							_d:{}
						},
						tmp="", i, ctr = 0,
						cr = doc.creator, acl = doc.acl, ow = doc.owners,
						S = "string", O = "object", F = "function",
						rr = /^r-/, ru = /^u-/;

					if (typeof cr == S && cr) {
						tmp = cr;
						if (!ru.test(tmp)) tmp = 'u-'+tmp;
						r._r[tmp] =  r._w[tmp] =  r._d[tmp] = 1;
						ctr+=1;
					}

					if (acl != null && typeof acl == O && typeof acl.slice == F ) {
						for (i=0;i<acl.length;i++) {
							tmp = acl[i];
							if (typeof tmp == S) {
								if (rr.test(tmp) || ru.test(tmp)) r._r[tmp] = 1;
								else r._r['u-'+tmp] = 1;
							}
						}
						ctr+=1;
					}

					if (ow != null && typeof ow == O && typeof ow.slice == F ) {
						for (i=0;i<ow.length;i++) {
							tmp = ow[i];
							if (typeof tmp == S) {
								if (!rr.test(tmp) && !ru.test(tmp)) tmp = 'u-'+tmp;
								r._r[tmp] =  r._w[tmp] = 1;
							}
						}
						ctr+=1;
					}

					if (!ctr) {
						tmp = "r-*";
						if (/^_design/.test(doc._id)) r._r[tmp] = 1;
						else r._r[tmp] =  r._w[tmp] =  r._d[tmp] = 1;
					}

					if (typeof doc.parent == S) r.p = doc.parent;

					emit(doc._id, r);
				}
			}
		},
		validate_doc_update:function(nd, od, userCtx, secObj) {
			var adm =!!( userCtx.roles.indexOf("_admin")>=0 ),
				u = userCtx.name,
				uu = 'u-'+ u,
				O = 'object',
				F = 'function',
				isA = function(o){
					return (typeof o == O && typeof o.slice == F);
				};

			if (!adm) {
				if (!od) {
					// Insert
					if (nd.creator && nd.creator != u && nd.creator != uu)
						throw({forbidden: 'Can’t create doc on behalf of other user.'});
				} else {
					// Update
					var odc = od.creator,
						odw = (isA(od.owners)?od.owners:[]).sort(),
						oda = isA(od.acl)?od.acl.sort()+'':'',
						ndc = nd.creator,
						ndw = (isA(nd.owners)?nd.owners:null).sort(),
						nda = isA(nd.acl)?nd.acl.sort()+'':'';

					if (odc && odc != ndc) throw({
						forbidden: 'Creator can not be changed.'
					});

					var notCreator = (ndc != u && ndc != uu),
						notOwner = notCreator && odw.indexOf(u)==-1 && odw.indexOf(uu)==-1;

					if (notCreator && odw+'' != ndw +'') throw({
						forbidden: 'Owners list can not be changed.'
					});

					if (notOwner && oda != nda) throw({
						forbidden: 'Readers list can not be changed.'
					});
				}
			}
		}
	}

	return ddoc;

}