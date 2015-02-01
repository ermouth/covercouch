

#CoverCouch

CoverCouch implements document grained r/w/d ACL for CouchDB. CoverCouch acts as proxy – original CouchDB REST API kept untouched, but each request to Couch – r/w/d, \_changes feed, \_view, \_update, \_list or other fn call, replication – *everything* is filtered.

Per-document ACL is defined using `creator`,`owners` and `acl` properties of the doc. Combination of their values, prepared by `_design/acl/_view/acl` view function, reflects final doc ACL.

Also CoverCouch implements per-method fine grained ACL – some paths like `_update/someFnName` can be restricted for several roles or users. CoverCouch can even restrict on query basis – for example we can allow `attachments=true` only for several roles.

All these rules, ACL view function and other ACL-related stuff are stored in `_design/acl` design doc. This ddoc defines access rules for particular CouchDB bucket.

Buckets that have no ACL ddoc, behave as native CouchDB.

Other CoverCouch features:

* multi-worker, workers are independent,
* has rate-locker, rejects excessive activity early,
* very fast – atomic ACL resolve is sync and takes <10µs,
* non-polling replies without attaches are gzipped in most cases.

And yes, it syncs with other CouchDBs and PouchDBs.

## Quick start

CoverCouch 0.1 is standalone app, it’s not a module right now. To install and run CoverCouch:

* CouchDB 1.6+ and node.js 0.10.35+ required
* `$ git clone git://github.com/ermouth/covercouch.git folderName`
* `$ cd folderName`
* `$ npm install`
* Edit general settings in `/cvr/config.js` 
* Run `$ node covercouch`
 
For buckets listed in `couch.preload` section of `/cvr/config.js`, design docs `_design/acl` are created automatically (if no present). Default ddoc template is located in `/cvr/ddoc.js`.

Now you have CouchDB wrapped with r/w/d ACL. 

## Per-document ACL

__Below text describes ACL behavior with default `_design/acl` ddoc. You can write your own implementation of it.__

Per-document ACL is defined using `creator`,`owners` and `acl` properties of particular doc. Also its `parent` property may point to ‘parent’ doc – in this case ACL is inherited from parent, if any.

All these properties are optional. If the first three are skipped, doc assumed to be free for r/w/d by any bucket user.

### `doc.creator` string

Format is `"userName"` or `"u-userName"`. User, that can perform any action with the doc, if op requested was not restricted on path basis. 

Creator, once set, can not be changed by non-admins. Non-admin can not set `creator` for new doc other than himself.

### `doc.owners` array

List of users and roles, who have very same permissions as creator, but they can not:

*  delete the doc,
*  modify `creator` and `owners` properties.

This property must look like `["u-userName1", "r-role1", "r-role2", "u-userName2", ...]`.

### `doc.acl` array

List of users and roles, that can read doc or attaches and call `_update` functions for the doc, that are not restricted on path basis. Format is same to `owners`.

### `doc.parent` string

Pointer from ‘child’ doc to its ‘parent’, `_id` of ‘parent’ doc. Parent ACL is superimposed with doc ACL, the most permissive rules win. 

Useful for comment-like docs – they may inherit ACL from parent post. Changes in parent ACL modify resulting access rules of children without changing child docs themselves.

###Example docs
````
{
    "_id": "123abc", "_rev": "1-abcd", 
    "type":       "message",
    "creator":    "u-mom",
    "owners":     ["u-dad"],
    "acl":        ["r-Johnsons", "u-kitchener"],  
    "body":       "What about summer fence? Ain’t it too early?"
}
--
{
    "_id": "234def", "_rev": "1-7390", 
    "type":       "comment",
    "creator":    "u-jim",
    "parent":     "123abc",  
    "body":       "Ok, unboxed it."
}
````
### Important edge case

__Please note, that `_update/function/docid` requests are validated using READ document permissions, not WRITE.__

Updates assumed safe – in general they change only several properties of the doc and control values received. Access to \_update functions themselves can be limited using per-bucket restrictions.

This combination allow readers, for example, mark doc as read or add some other data to doc using appropriate \_update. Compared with general ‘write document’, that can totally destruct the doc, \_update functions modify docs in controllable way.

Choice between r-w-u-d and r-w-d was made when I analyzed how real sets of these permissions might look like. In nearly every case read permissions were equal to update permissions – so special set of update permissions was removed.


## Per-bucket ACL and restrictions

Design doc `_design/acl` may have properties `restrict` and/or `dbacl`:

* Object `restrict` allow to fine-tune permissions for particular CouchDB REST functions. 
* Object `dbacl` is superimposed with any doc-defined ACL during access rights resolution.

Example:

````
{
    "_id": "_design/acl", "_rev": "1-2345",
    "views":{"acl":{"map":"function(doc){...}"}},
    "acl": [],
    "restrict":{
        "*": ["r-marketing", "r-sales", "u-boss", "u-cfo"],
        "get":{
            "*attachments=true": ["u-cfo"]
        },
        "post":{
            "*attachments=true": ["u-cfo"]
            "_update/approveBudget": ["u-cfo"]
        },
        "put":{
            "*": []
        }
    },
    "dbacl":{
        "_r": ["u-cfo", "u-boss"],
        "_w": ["u-boss"]
    }
}
````
Array `restrict.*` have special meaning – it restricts users and roles, that have access to the bucket. Main difference between CouchDB security object and `restrict.*` is that buckets, inaccessible for user, are eliminated from `/_all_dbs` reply.

Objects `restrict.get`, `restrict.post` and so on limit access to particular CouchDB API functions. Their keys are path fragments. Two wildcards are possible for keys:

* `*` is one or more characters;
* `+` is one or more characters, other than `/`.

Above example ddoc’s `restrict` means that:

* only marketing and sales depts, boss and CFO see this bucket;
* no one (except admins, surely) can put doc or attach into bucket directly;
* only CFO can call `approveBudget` update function (from unspecified ddoc);
* only CFO can fetch data with attaches included.

Example `dbacl` property means, that CFO and boss can read any doc from bucket regardless of rules in per-doc ACL. Boss also can write into any doc.

Properties `acl`, `creator` and `owners`, defined for design doc, only restrict access to ddoc itself, it’s body and attaches, not to functions it expose. Above example ddoc is marked invisible for all users except admins with `"acl":[]`.

## How request is processed

Generally, request is processed by several middlewares. Each processor evaluates some restrictions and pass request through, or modifies and then pass, or rejects it. 

General sequence for bucket-related request:

1. Rate locker rejects request if thread is out of capacity or remote client makes too many requests.
2. Session manager checks user creds or session and reject invalid.
3. DB locker rejects request if user have no permissions to deal with requested bucket.
4. Method locker rejects request if user have no rights to exec requested method and/or query.
5. If create/write requested, input data is filtered. Docs, that user have no permissions to write into, are eliminated from request.
6. Request is passed to CouchDB
7. CouchDB applies own security rules and `validate_doc_update` from `_design/acl`, that denies invalid ACL-related properties changes.
8. CouchDB response is filtered, docs that user is not allowed to read, are eliminated.
9. Response is sent or piped to user.

Processors and mappings between CouchDB API routes and flow chains are contained in `/cvr/router.js` and `/cvr/restmap.js` files.


## Some technical details

### RAM

CoverCouch is memory-intensive. Entire bucket ACL is memcached on first access or start. Moreover, each worker has its’s own ACL cache, they are not shared.

This approach allows to resolve ACL synchronously in microseconds – but it costs ~300–500 bytes of RAM for each doc, and you should multiply result by number of workers.

So if you have 1M doc DB that need per-doc ACL (very rear case in CouchDB world), you need 500Mb+ of RAM for each worker. 

Also when CoverCouch pipes, it need about 3 times more RAM, then two subsequent rows transmitted. Be careful if you inline 100Mb attach in JSON – you may need to wire ~400Mb to process pipe slice.


### Fetch/resend vs pipe

__Fetch/resend__ strategy is used for ‘not very long’ requests that can produce set of rows. CoverCouch fetches entire CouchDB response, filters it and resends gzipped reply to client.

‘Not very long’ means that no inlined attachments expected and request has some range limiting keys (`startkey`–`endkey`,`keys` or `key`).

Fetch/resend strategy allows to send response faster (sometimes much faster) due to compression and unnecessary response fragmentation removal.

__Pipe__ strategy is used for potentially ‘long’ requests: feeds, or requests with attaches inlined, or with no query limits.

Single-doc and attachment GETs are also piped.


### Auto restart

Each worker restarts daily at an hour, defined in `workers.reloadAt` conf key. Restart takes back frozen and leaked memory and terminates hung feeds. Sibling threads never restart simultaneously – min gap is defined in `workers.reloadOverlap`.


## Limitations

### No reduce

Reduce requests return incorrect (unfiltered) results right now. Gonna fix it in 0.2.

### Authorization methods

Only cookie and basic auth supported. Request with `user:pwd@domain.name` are treated as they have no auth in URL.

### Length of `_id`

Length of `_id` property is limited to 200 chars by default to speed up regexp, that digs out doc `_id`s from pipe without parsing JSON. 

Doc _id length limit is defined in `couch.maxIdLength` conf property. This limit does not in any way restricts creation of docs with longer `_id`s. The limitation means ‘we assume DB has no docs with ids longer, than 200 chars’.

### Weird behavior of `limit` query param

Since CouchDB response is filtered, we can not expect, that `limit` param works properly in all cases. CouchDB can, for example, send 10 docs – and they all may be eliminated from response by ACL. 

To avoid this behavior do not use CoverCouch as an intentional filter, ACL engine was not intended to be a filter.

For example, do not use ACL-filtered `_all_docs` to retrieve all user docs. Much better way is to make special view for it and them tap it with key range. Also this approach is much faster.

Same for `limit`. Use special views and key ranges, not `limit`, to fetch predictable set of docs.

### Futon

Futon is visible for everyone, but works fine only for admins. Also please note, that Logout link in Futon does not work since it use `_:_@your.couch.url/_session` auth syntax.


### No COPY method

COPY request processors are not yet implemented. 

## Known issues and plans

Tests suits and demos are underway. Same for interactive ddoc JSON editor (see current version at [http://cloudwall.me/etc/json-editor.html](http://cloudwall.me/etc/json-editor.html)).

Also going to implement precache-free ACL mode – async and more slow, but less memory demanding.

Please, feel free to open issues or contribute.

---

© 2015 ermouth. CoverCouch is MIT-licensed.
