/*
* Copyright (c) 2011 Eran Hammer-Lahav. All rights reserved. Copyrights licensed under the New BSD License.
* See LICENSE file included with this code project for license terms.
*/

// Load modules

var Hapi = require('hapi');
var Db = require('./db');
var Project = require('./project');
var Task = require('./task');


// Declare internals

var internals = {};


// Last information for project (with tasks)

exports.getProject = {
    
    handler: function (request) {

        exports.load(request.session.user, function (last, err) {

            if (last &&
                last.projects &&
                last.projects[request.params.id]) {

                var record = { id: last._id, projects: {} };
                record.projects[request.params.id] = last.projects[request.params.id];

                request.reply(record);
            }
            else if (err === null) {

                request.reply({ id: request.session.user, projects: {} });
            }
            else {

                request.reply(err);
            }
        });
    }
};


// Set last project timestamp

exports.postProject = {
    
    handler: function (request) {

        Project.load(request.params.id, request.session.user, false, function (project, member, err) {

            if (project) {

                exports.setLast(request.session.user, project, null, function (err) {

                    if (err === null) {

                        request.reply({ status: 'ok' });
                    }
                    else {

                        request.reply(err);
                    }
                });
            }
            else {

                request.reply(err);
            }
        });
    }
};


// Last information for single task

exports.getTask = {
    
    handler: function (request) {

        Task.load(request.params.id, request.session.user, false, function (task, err, project) {

            if (task) {

                exports.load(request.session.user, function (last, err) {

                    if (last &&
                        last.projects &&
                        last.projects[task.project] &&
                        last.projects[task.project].tasks &&
                        last.projects[task.project].tasks[request.params.id]) {

                        var record = { id: last._id, projects: {} };
                        record.projects[task.project] = { tasks: {} };
                        record.projects[task.project].tasks[request.params.id] = last.projects[task.project].tasks[request.params.id];

                        request.reply(record);
                    }
                    else if (err === null) {

                        request.reply({ id: request.session.user, projects: {} });
                    }
                    else {

                        request.reply(err);
                    }
                });
            }
            else {

                request.reply(err);
            }
        });
    }
};


// Set last task timestamp

exports.postTask = {
    
    handler: function (request) {

        Task.load(request.params.id, request.session.user, false, function (task, err, project) {

            if (task) {

                exports.setLast(request.session.user, project, task, function (err) {

                    if (err === null) {

                        request.reply({ status: 'ok' });
                    }
                    else {

                        request.reply(err);
                    }
                });
            }
            else {

                request.reply(err);
            }
        });
    }
};


// Load user last timestamps

exports.load = function (userId, callback) {

    Db.get('user.last', userId, function (item, err) {

        if (item) {

            callback(item, null);
        }
        else {

            if (err === null) {

                callback(null, null);
            }
            else {

                callback(null, err);
            }
        }
    });
};


// Clear project last

exports.delProject = function (userId, projectId, callback) {

    exports.load(userId, function (last, err) {

        if (last &&
            last.projects &&
            last.projects[projectId]) {

            var changes = { $unset: {} };
            changes.$unset['projects.' + projectId] = 1;

            Db.update('user.last', last._id, changes, function (err) {

                if (err === null) {

                    callback(null);
                }
                else {

                    callback(err);
                }
            });
        }
        else if (err) {

            callback(err);
        }
    });
};


// Set last timestamp

exports.setLast = function (userId, project, task, callback) {

    var now = Date.now();

    exports.load(userId, function (last, err) {

        if (err === null) {

            if (last) {

                // Existing last record

                var changes = { $set: {} };

                if (task === null) {

                    // Project last: last->projects.{projectId}.last

                    if (last.projects) {

                        if (last.projects[project._id]) {

                            changes.$set['projects.' + project._id + '.last'] = now;
                        }
                        else {

                            changes.$set['projects.' + project._id] = { tasks: {}, last: now };
                        }
                    }
                    else {

                        changes.$set.projects = {};
                        changes.$set.projects[project._id] = { tasks: {}, last: now };
                    }
                }
                else {

                    // Task last: last->projects.{projectId}.tasks.{taskId}

                    if (last.projects) {

                        if (last.projects[project._id]) {

                            if (last.projects[project._id].tasks) {

                                changes.$set['projects.' + project._id + '.tasks.' + task._id] = now;
                            }
                            else {

                                changes.$set['projects.' + project._id + '.tasks'] = {};
                                changes.$set['projects.' + project._id + '.tasks'][task._id] = now;
                            }
                        }
                        else {

                            changes.$set['projects.' + project._id] = { tasks: {} };
                            changes.$set['projects.' + project._id].tasks[task._id] = now;
                        }
                    }
                    else {

                        changes.$set.projects = {};
                        changes.$set.projects[project._id] = { tasks: {} };
                        changes.$set.projects[project._id].tasks[task._id] = now;
                    }
                }

                Db.update('user.last', last._id, changes, function (err) {

                    callback(err);
                });
            }
            else {

                // First last timestamp

                last = { _id: userId, projects: {} };
                last.projects[project._id] = { tasks: {} };

                if (task === null) {

                    last.projects[project._id].last = now;
                }
                else {

                    last.projects[project._id].tasks[task._id] = now;
                }

                Db.insert('user.last', last, function (items, err) {

                    callback(err);
                });
            }
        }
        else {

            callback(err);
        }
    });
};


// Remove entire last record

exports.delUser = function (userId, callback) {

    Db.remove('user.last', userId, callback);
};



