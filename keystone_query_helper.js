// TODO: Change all of this into ES2015 syntax

var keystone = require('keystone');
// var mongooseCache = require('mongoose-cache-manager');
//
// // patch mongoose with default options
// mongooseCache(keystone.mongoose, {
// 	cache: true,
// 	ttl: 60,
// 	store: 'memory',
// 	prefix: 'cache'
// });

function Queries(view, locals) {

	if (arguments.length === 1) {
		this._locals = view;
	} else {
		this._view = view;
		this._locals = locals;
	}

	/**
	 *
	 ********* HELPERS **********
	 *
	 */

	this._errHandlers = {
		err: function(err, res) {
			console.log('oops... something went wrong -------', err);
			res.status(500).render('errors/500');
		},
		noResults: function(res) {
			console.log('oops... no content here -------');
			res.status(404).render('errors/404');
		}
	};

	// TODO: Improve this
	this._translate = function(results, locale) {
		var objCopy = JSON.parse(JSON.stringify(results));

		var iterateAndTranslate = function iterateAndTranslate(item) {
			Object.keys(item).forEach(function(prop) {
				if (item[prop] &&
					typeof item[prop] !== 'undefined' &&
					item[prop] !== null &&
					item[prop].hasOwnProperty(locale[0])) {
					if (Object.keys(item[prop][locale[0]]).length !== 0 &&
						JSON.stringify(item[prop][locale[0]]) !== JSON.stringify({})) {
						item[prop] = item[prop][locale[0]];
					} else {
						item[prop] = item[prop][locale[1]];
					}
				}
			});
		}

		if (Object.prototype.toString.call(objCopy) === '[object Object]') {
			iterateAndTranslate(objCopy);
			return objCopy;
		} else if (Object.prototype.toString.call(objCopy) === '[object Array]') {
			objCopy.forEach(function(result) {
				iterateAndTranslate(result);
			});
			return objCopy;
		}
	};

	/**
	 *
	 * Sort by order and then limit ordered results.
	 * At the moment this only works for "servicio",
	 * as it goes through an array twice before sorting.
	 *
	 * This is in need of a refactor. As of now it is sorting the
	 * results accourding to 'createdAt', but this
	 * should soon be modified to sort only if needed and sort
	 * by the parameter necessary.
	 *
	 */
	this._sortAndLimit = function(results, prop, limit) {

		var limitArr = [];
		var newArr = [];
		var limitArrInner;


		function sortMe(a, b) {
			return Date.parse(b.createdAt) - Date.parse(a.createdAt);
		}

		if (arguments[3]) {

			var arg = arguments[3];

			results.forEach(function(item) {
				limitArrInner = [];

				if (item[prop] && item[prop][arg]) {
					item[prop][arg].forEach(function(propVal) {
						limitArrInner.push(propVal);
					});

					limitArr.push(limitArrInner);
				}

			});

			limitArr.forEach(function(elem) {
				newArr.push(elem.sort(sortMe).slice(0, limit));
			});

			return newArr;

		} else {

			results.forEach(function(item) {
				limitArrInner = [];
				item[prop].forEach(function(propVal) {
					limitArrInner.push(propVal);
				});
				limitArr.push(limitArrInner);
			});

			limitArr.forEach(function(elem) {
				newArr.push(elem.sort(sortMe).slice(0, limit));
			});

			return newArr;
		}

	};


}


/**
 *
 * TODO: Refactor this into a more generic findAll.
 * Make a better implementation of this
 * temporary findAll
 *
 */
Queries.prototype.findAll = function(qData, cb) {
	var _this = this;

	function _find(qData, fcb) {

		var q = keystone.list(qData.model).model.find(qData.params)
			.select(qData.select || '')
			.limit(qData.limit || '')
			.sort(qData.sort || '');

		if (qData.lean) {
			q.lean();
		}

		if (qData.populate) {
			qData.populate.forEach(function(populate) {
				if (populate.length > 1) {
					q.populate(populate[0], populate[1]);
				} else {
					q.populate(populate[0]);
				}
			});
		}

		if (qData.where) {
			qData.where.forEach(function(param) {
				q.where((param.name ? param.name : null), (param.val ? param.val : null));
			});
		}
		if (qData.lean) q.lean();

		q.exec(function(err, results) {

			var moveOn = function(err) {
				if (qData.locale && qData.locale.length) {
					results = Object.assign(results, _this._translate(results, qData.locale));
				}

				if (typeof qData.xhr === 'function') {
					if (qData.path) {
						results.forEach(function(elem, i) {
							elem._doc[qData.path] = elem[qData.path];
						});
					}
					_this._locals.data[qData.local] = results;
					qData.xhr(_this._locals);
				} else {
					_this._locals.data[qData.local] = results;
				}

				fcb(err);
			};

			if (results && qData.path) {

				var arr = [];
				if (qData.populate && !qData.populateResults) {

					results.forEach(function(elem) {
						if (elem[qData.populate]) {
							arr.push(elem[qData.populate]);
						}
					});
				} else {
					arr = results;
				}

				keystone.populateRelated(arr, qData.path, function(err) {

					if (err) console.log('err', err);

					if (qData.limitPath) {
						_this._locals.data[qData.localRel] = _this._sortAndLimit(results,
							qData.populate, qData.limitPath, qData.path);
					}

					moveOn(err);
				});
			} else {
				moveOn(err);
			}
		});

	}

	if (cb) {
		_find(qData, cb);
	} else {
		this._view.on('init', function(next) {
			_find(qData, next);
		});
	}
};

/**
 *
 * TODO: Keep going with further refactor.
 * Add a limit to the second level. As of now there's only a limit
 * for the third level.
 *
 * Used https://gist.github.com/JedWatson/8519978
 * as a reference for projectPopulate and went
 * from there.
 *
 * It could also be a good idea to make the deeper queries
 * separate functions. Possibly even a single recursive function.
 * I will do this when all other Interaction features and
 * tasks are over to hopefully use for the "Esqueleto".
 *
 */
Queries.prototype.findOne = function(qData, cb) {
	var _this = this;

	function _find(qData, fcb) {
		var q = keystone.list(qData.model).model.findOne(qData.params)
			.populate(qData.populate || '');

		if (qData.where) {
			qData.where.forEach(function(param) {
				q.where((param.name ? param.name : null), (param.val ? param.val : null));
			});
		}

		/**
		 * If lean param is set, return lean result
		 * BE CAREFUL WITH THIS IF YOU'RE TRYING TO populateRelated
		 * AS IT EXCLUDES MONGOOSE METHODS!!!
		 */
		if (qData.lean) q.lean();

		q.exec(function(err, result) {
			var copyResult;
			/**
			 * Check if there are any errors to return err partials
			 */
			if (qData.ignore && (err || !result)) {
				fcb();
				return;
			} else if (err) {
				_this._errHandlers.err(err, qData.res);
				return;
			} else if (!result) {
				_this._errHandlers.noResults(qData.res);
				return;
			}

			/**
			 * Translate if indicated
			 */
			if (qData.locale && qData.locale.length) {
				copyResult = _this._translate(result, qData.locale);
			}

			/**
			 * Check if it's a recursive function and get in on the
			 * second query
			 */
			if (result && qData.recursiveParams) {
				var params = qData.recursiveParams.params;

				/**
				 * Set the result of the first query to the specified
				 * local before the second one is triggered
				 */
				_this._locals.data[qData.local] = result;
				// console.log(qData.local, _this._locals.data[qData.local]);


				/**
				 * This sets the new params to pass to mongo's find().
				 * A param should always be set on the query call on the
				 * controller's side. If the second query is dynamic
				 * then set the properties to empty strings, else specify it there.
				 */
				Object.keys(params).forEach(function(param) {
					if (!params[param].length) {
						params[param] = result[qData.populate][param];
					}
				});

				/**
				 * Set the new qData for the second query and then call it
				 */
				qData = qData.recursiveParams;

				_find(qData, fcb);

				/*
				 * If recursion is not necessary keep going with the query
				 */
			} else {

				if (result && qData.path) {
					result.populateRelated(qData.path, function(err) {
						if (qData.pathDeep) {

							keystone.populateRelated(result[qData.path], qData.pathDeep,
								function(err) {

									if (err) console.log('err', err);

									if (qData.limit) {

										/**
										 * This will sort and limit the results to only return
										 * the amount required. As of now it is sorting the
										 * results accourding to 'createdAt', but this
										 * should soon be modified to sort only if needed and sort
										 * by the parameter necessary.
										 */
										_this._locals.data[qData.localRelDeep] = _this._sortAndLimit(
											result[qData.path], [qData.pathDeep], qData.limit);

										fcb(err);

									} else {
										fcb(err);
									}

								});

						} else {
							_this._locals.data[qData.localRel] = result[qData.path];
							fcb(err);
						}
					});

				} else {
					fcb(err);
				}

				_this._locals.data[qData.local] = copyResult;

				if (typeof qData.xhr === 'function') {
					qData.xhr(_this._locals);
				}

			}
		});

	}

	if (cb) {
		_find(qData, cb);
	} else {
		this._view.on('init', function(next) {
			_find(qData, next);
		});
	}

};


Queries.prototype.count = function(qData, cb) {

	var _this = this;

	function _find(qData, fcb) {
		keystone.list(qData.model).model.count(qData.params, function(err, count) {
			_this._locals.data[qData.local] = count;
			fcb(err);
		});
	}

	if (cb) {
		_find(qData, cb);
	} else {
		this._view.on('init', function(next) {
			_find(qData, next);
		});
	}

}


module.exports = exports = Queries;
