/**
 * Std lib for JSON manipulation
 * Created by ermouth 2014-11-11
 */

module.exports = function (cw) {

	var n = function (o) {return o!==null && o!==undefined;},
		isA = Object.isArray, isB = Object.isBoolean, isS = Object.isString, isO = Object.isObject,
		isN = Object.isNumber, isR = Object.isRegExp, isF = Object.isFunction,
		Fu = "function";

	var l = cw.lib = {

		"getref":_getref,

		"a2o": function (a0, all) {
			//converts array of string to object with keys of strings
			var ob = {}, s = "", v;
			if (!Object.isArray(a0)) return ob;
			for (var i = 0; i < a0.length; i++) {
				v = a0[i];
				if (all || v !== null && v !== undefined && v !== false && v !== "") {
					if (!ob[v]) ob[v] = 0;
					ob[v] += 1;
				}
			}
			return ob;
		},
		"dry": function (obj, full) {
			/*  makes shallow copy of obj and
			 * removes all keys that starts with _ except _id and _rev,
			 * if full==true, removes _id and _rev */
			var dry = {}, i;
			for (i in obj) if (obj.hasOwnProperty(i)
				&& (i.substr(0, 1) !== "_"
					|| (!full && (i === "_id" || i === "_rev")) || i === "_attachments")
				) dry[i] = obj[i];
			return dry;
		},
		"fuse": function fuse(o1, o2) {
			// overlaps o2 over o1, arrays are completely replaced with clone of, not merged
			if (arguments.length == 0) return {};
			if (arguments.length == 1) return arguments[0];
			for (var i = 1; i < arguments.length; i++) Object.merge(arguments[0], arguments[i], false, function (key, a, b) {
				if (b === undefined || b === null) return a;
				if (isA(b)) return Object.clone(b, true);
				else if (!isO(b)) return b;
				else return Object.merge(a, b, false);
			});
			return arguments[0];
		},
		"overlap": function (o1, o2) {
			//overlaps o2 over o1, arrays are completely replaced, not merged
			return Object.merge(o1,o2, false, function(key,a,b) {
				if (!Object.isObject(b)) return b;
				else return Object.merge(a,b,false);
			});
		},
		"sdbmCode":function (s0){
			//very fast hash used in Berkeley DB
			for (var s = JSON.stringify(s0), hash=0,i=0;i<s.length;i++)
				hash=s.charCodeAt(i)+(hash<<6)+(hash<<16)-hash;
			return (1e11+hash).toString(36);
		},
		"json":(function () {
			function f(n){return n<10?'0'+n:n;}
			Date.prototype.toJSON=function () {
				var t=this;return t.getUTCFullYear()+'-'+f(t.getUTCMonth()+1)+'-'+f(t.getUTCDate())+
					'T'+f(t.getUTCHours())+':'+f(t.getUTCMinutes())+':'+f(t.getUTCSeconds())+'Z';
			};
			RegExp.prototype.toJSON = function () {return "new RegExp("+this.toString()+")";};
			var tabs= '\t'.repeat(10), fj = JSON.stringify;

			// - - - - - - - - - - - - - - - - - - - - - - -
			function s2 (w, ctab0, tab){
				var tl=0,a,i,k,v,ctab=ctab0||0,xt = tabs;
				if (tab && isS(tab)) {tl=String(tab).length;xt = String(tab).repeat(10);}
				switch((typeof w).substr(0,3)){
					case 'str': return fj(w);case'num':return isFinite(w)?''+String(w)+'':'null';
					case 'boo': case'nul':return String(w);
					case 'fun': return fj(
						w.toString().replace(/^(function)([^\(]*)(\(.*)/,"$1 $3")
							.replace(/(})([^}]*$)/,'$1')
					);
					case 'obj': if(!w) return'null';
						if (typeof w.toJSON===Fu) return s2(w.toJSON(),ctab+(tab?1:0),tab);
						a=[];
						if (isA(w)){
							for(i=0; i<w.length; i+=1){a.push(s2(w[i],ctab+(tab?1:0),tab)||'null');}
							return'['+a.join(','+(tab?"\n"+xt.to(ctab*tl+tl):""))+']';
						}
						for (k in w) if (isS(k)) {
							v=s2(w[k],ctab+(tab?1:0),tab);
							if(v) a.push((tab?"\n"+xt.to(ctab*tl+tl):"")+s2(k,ctab+(tab?1:0),tab)+': '+v);
						}
						return '{'+a.join(',')+(tab?"\n"+xt.to(ctab*tl):"")+'}';
				}
			}

			return s2.fill(undefined,0,undefined);

		})(),
		"fromjson": function (s) {var obj = JSON.parse(s); _unjson(obj);return obj;},
		"unjson": function(o) {_unjson(o);return o;},
		"mask":function (src, mask0) {
			//returns src obj masked with mask
			if (!isO(src)) return null;
			var res, mask=mask0;
			if (isS(mask)) {
				return _getref(src, mask);
			} else if (isA(mask)) {
				res = [];
				for (var i=0;i<mask.length;i++) {
					res[i]=isS(mask[i])?_getref(src, mask[i])||null:null;
				}
				return res;
			} else if (isO(mask))
				return _merge(src, mask);
			//- - - -
			function _merge(src, mask) {
				if (!isO(mask)) return {};
				var dest = {};
				for (var i in mask) {
					if (!isO(mask[i]) && src.hasOwnProperty(i)) {
						dest[i]=Object.clone(src[i],true);
					}
					else if (src.hasOwnProperty(i)) {
						if (isO(src[i])) dest[i]=_merge(src[i],mask[i]);
						else dest[i] = Object.clone(src[i],true);
					}
				}
				return dest;
			}
		},
		"unmask": function (src, mask) {
			// unfolds masked into obj
			var res={};
			if (isO(src) && isO(mask)) return f.mask(src,mask);
			else if (isA(src) && isA(mask)) {
				for (var i=0;i<mask.length;i++) {
					if (src[i]!=null) _blow(res, src[i], mask[i]);
				}
				return res;
			} else if (isS(mask)) return _blow({}, src, mask);
			else return null;

			//- - -
			function _blow(data, src, ref) {
				var ptr, path, preptr, val=Object.clone(src,true), i=0;
				if (!/\./.test(ref)) {
					//ref is flat
					if (null!=src) data[ref] = val;
				} else {
					path = ref.split(".").each(function (a,i){this[i]=String(a).compact();});
					ptr = data;
					for (;i<path.length;i++) {
						if (i===path.length-1) ptr[path[i]] = val; //we'r in the hole
						if (i===0) ptr = data[path[0]], preptr= data;
						else preptr = preptr[path[i-1]], ptr = ptr[path[i]];
						if (undefined===ptr) ptr = preptr[path[i]] = {};
					}
				}
				return data;
			}
		}

	}

	return l;


	//=======================================

	function _unjson (node, exclude){
		//recursively unwinds string def of funcs and regexps, modifies  source obj!
		var i="", nd, t="", incl = !exclude, a=[];
		for (i in node) if (node.hasOwnProperty(i) && (incl || !/^(data|files|require)$/.test(i))) {
			nd = node[i];
			t = typeof nd;
			if (isO(nd) || isA(nd)) _unjson(nd);
			else if (t==="string" && /^(function\s?\(|new\sRegExp)/.test(nd)) {
				if (a = nd.match(/^function\s?\(([^\)]*)\)\s*\{([\s\S]*)\}$/)) {
					if (a.length===3) {
						try { node[i] = Function(a[1], a[2]); }
						catch(e){ console.log(e.message, e.stack, nd);}
					}
				}
				else if (a = nd.match(/^new\sRegExp\(\/([\s\S]+)\/([a-z]*)\)$/)) {
					if (a.length===3) {
						try { node[i] = RegExp(a[1], a[2]); }
						catch (e) { console.log(e.message, e.stack, nd); }
					}
				}
			}
		}
		a=null;
	}

	// - - - - - - - - - - - - - - - - - - - -

	function _getref(obj,ref) {
		//gets branch of obj by string ref like "data.list.items.1"
		return (ref||"").split(".").reduce(function (a,b){
			if (null!=a && null!=a[b]) return a[b];
			else return undefined;
		}, obj);
	}

};