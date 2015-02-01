/**
 * CoverCouch 0.1.1 REST map
 * Created by ermouth on 22.01.15.
 */

module.exports = function (cvr) {

	// Processing chains for CouchDB API members in human-readable form.
	// Later router.js unwinds {get:{/db:{/_design/id:'db,doc,pipe'}}}
	// into express.js routes like
	// router.get('/:db/_design/:id', actors.db, actors.doc, actors.pipe).
	// Keys order is important!

	var routes = {},
		map = {
	get:{
		//'/_test':			'test',
		'/':				'pipe',
		'/_session':		'session',
		'/_active_tasks':	'admin',
		'/_all_dbs':		'dblist',
		'/_db_updates':		'admin',
		'/_log':			'admin',
		'/_stats':			'admin',
		'/_stats/*':		'admin',
		'/_config':			'admin',
		'/_config/*':		'admin',
		'/_utils':			'admin',
		'/_utils/*':		'admin',
		'/_uuids':			'pipe',

		'/db':{
			'':				'db,pipe',
			'/_all_docs':	'db,rows',
			'/_changes':	'db,changes',
			'/_security':	'admin',
			'/_revs_limit':	'admin',
			'/id':			'db,doc,pipe',

			'/_design/id':			'db,doc,pipe',
			'/_design/id/fname':	'db,doc,pipe',
			'/_local/id':	'db,pipe',
			'/id/fname':	'db,doc,pipe',

			'/_design/ddoc': {
				'/_info': 	'admin',

				'/_view/view':	'db,rows',
				'/_show/show':	'pipe',
				'/_rewrite/p':	'admin',

				'/_list/list/view': 'db,list',
				'/_show/show/id': 	'db,doc,pipe',

				'/_list/list/ddoc2/view':	'db,list'
			}
		}
	},
	post:{
		'/_session':		'body,auth',
		'/_replicate':		'admin',
		'/_restart':		'admin',
		'/db':{
			'':				'db,body,doc,pipe',
			'/_all_docs':	'db,body,rows',
			'/_bulk_docs':	'db,body,bulk',
			'/_changes':	'db,changes',
			'/_compact':	'admin',
			'/_compact/*':	'admin',
			'/_view_cleanup':	'admin',
			'/_temp_view':		'admin',
			'/_purge':			'admin',
			'/_missing_revs':	'db,body,revs',
			'/_revs_diff':		'db,body,revs',
			'/_ensure_full_commit':	'admin',

			'/_design/ddoc':{
				'/_view/view':		'db,body,rows',
				'/_show/show':		'db,pipe',
				'/_update/update':	'db,pipe',

				'/_list/list/view':		'db,list',
				'/_show/show/id':		'db,body,doc,pipe',
				'/_update/update/id':	'db,body,doc,pipe',			// Update checks R, not W permissions!

				'/_list/list/ddoc2/view':	'db,list'
			}
		}
	},
	put:{
		'/db':{
			'':				'admin',
			'/_security':	'admin',
			'/_revs_limit':	'admin',
			'/id':			'db,doc,pipe',
			'/_design/id':			'db,doc,pipe',
			'/_design/id/fname':	'db,doc,pipe',
			'/_local/id':			'db,pipe',
			'/id/fname':			'db,doc,pipe',
			'/_design/ddoc/_update/update/id':	'db,doc,pipe'
		}
	},
	head:{
		'/db':{
			'':					'db,pipe',
			'/id':				'db,doc,pipe',
			'/_design/id':		'db,pipe',
			'/id/fname':		'db,doc,pipe',
			'/_design/id/fname':'db,pipe'
		}
	},
	delete:{
		'/_session':		'session',
		'/db':{
			'':				'admin',
			'/id':			'db,doc,pipe',
			'/_design/id':			'db,doc,pipe',
			'/_design/id/fname':	'db,doc,pipe',
			'/_local/id':	'db,pipe',
			'/id/fname':	'db,doc,pipe'
		}
	}
	}
	// -- end of request actors map

	var go = function(r, key, obj){
		if (Object.isObject(obj)) {
			for (var i in obj) go (r,key+i, obj[i]);
			return r;
		} else r.push({
			path:key.split("/").map(function(e){
				if(e&&!/^[_\*]/.test(e))return':'+e;
				else return e;
			}).join("/"),
			ops:obj.split(/\*?,\s*/).compact(true)
		});
	};
	// Build routes
	for (var i in map) {
		routes[i]=[];
		go(routes[i],'',map[i])
	}

	return routes;

}