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


// Move to ES6 syntax
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
			return res.status(500).render('errors/500');
		},
		noResults: function(res) {
			console.log('oops... no content here -------');
			return res.status(404).render('errors/404');
		}
	};

	// TODO: Make translation automatic
	this._translate = function(result) {
		if (result.nameEn) {
			result.name = result.nameEn;
		}

		if (result.subtitleEn) {
			result.subtitulo = result.subtitleEn;
		}

		if (result.contentEn && result.contentEn.extended) {
			Object.keys(result.contentEn).forEach(function(key) {
				result.content[key] = result.contentEn[key];
			});
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
	 * by the requested parameter.
	 *
	 * This specially should be in ES6 for performance improvements
	 * on using arguments.
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

	var self = this;

	function _find(qData, fcb) {

		var q = keystone.list(qData.model).model.find(qData.params)
			.sort(qData.sort || '')
			.populate(qData.populate || '')
			.populate(qData.populate2 || '')
			.limit(qData.limit || '');

		if (qData.where) {
			qData.where.forEach(function(param) {
				q.where((param.name ? param.name : null), (param.val ? param.val : null));
			});
		}
		if (qData.lean) q.lean();

		q.exec(function(err, results) {

			var moveOn = function(err) {
				if (qData.req && qData.req.getLocale() === 'en') {
					self._translate(results);
				}

				self._locals.data[qData.local] = results;

				if (typeof qData.xhr === 'function') {
					qData.xhr(self._locals);
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
						self._locals.data[qData.localRel] = self._sortAndLimit(results,
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

	var self = this;

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

			/**
			 * Check if there are any errors to return err partials
			 */
			if (err) {
				self._errHandlers.err(err, qData.res);
			} else if (!result) {
				self._errHandlers.noResults(qData.res);
			}

			/**
			 * Check if the site is in English.
			 * If so, check if there are English versions and replace
			 * the Spanish versions here on the backend
			 *
			 */
			if (qData.req && qData.req.getLocale() === 'en') {
				self._translate(result);
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
				self._locals.data[qData.local] = result;
				// console.log(qData.local, self._locals.data[qData.local]);


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
										self._locals.data[qData.localRelDeep] = self._sortAndLimit(
											result[qData.path], [qData.pathDeep], qData.limit);

										fcb(err);

									} else {
										fcb(err);
									}

								});

						} else {
							self._locals.data[qData.localRel] = result[qData.path];
							// console.log(qData.localRel, self._locals.data[qData.localRel]);

							fcb(err);
						}
					});

				} else {
					fcb(err);
				}

				self._locals.data[qData.local] = result;
				// console.log(self._locals.data[qData.local]);

				if (typeof qData.xhr === 'function') {
					// console.log('self._locals ---------', self._locals);
					qData.xhr(self._locals);
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


module.exports = exports = Queries;
