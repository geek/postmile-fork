/*
* Copyright (c) 2011 Eran Hammer-Lahav. All rights reserved. Copyrights licensed under the New BSD License.
* See LICENSE file included with this code project for license terms.
*/

// Load modules

var Hapi = require('hapi');
var Db = require('./db');
var Project = require('./project');
var Sort = require('./sort');
var Suggestions = require('./suggestions');
var Details = require('./details');
var Stream = require('./stream');


// Task information

exports.get = {
    
    handler: function (request) {

        exports.load(request.params.id, request.session.user, false, function (task, err) {

            if (task) {

                Details.expandIds([request.params.id], task.project, request.session.user, function (details) {

                    if (details &&
                        details[request.params.id]) {

                        task.detailsModified = details[request.params.id].modified;
                        task.detailsModifiedBy = details[request.params.id].user;
                        task.last = details[request.params.id].last;
                    }

                    Hapi.Utils.removeKeys(task, ['origin']);
                    request.reply(task);
                });
            }
            else {

                request.reply(err);
            }
        });
    }
};


// Get list of tasks for given project

exports.list = {
    
    handler: function (request) {

        Project.load(request.params.id, request.session.user, false, function (project, member, err) {

            if (project) {

                Sort.list('task', request.params.id, 'project', function (tasks) {

                    if (tasks) {

                        var list = [];
                        var ids = [];

                        for (var i = 0, il = tasks.length; i < il; ++i) {

                            var task = {

                                id: tasks[i]._id,
                                title: tasks[i].title,
                                status: tasks[i].status
                            };

                            if (tasks[i].participants) {

                                for (var p = 0, pl = tasks[i].participants.length; p < pl; ++p) {

                                    if (tasks[i].participants[p] === request.session.user) {

                                        task.isMe = true;
                                        break;
                                    }
                                }

                                task.participantsCount = tasks[i].participants.length;
                            }
                            else {

                                task.participantsCount = 0;
                            }

                            list.push(task);
                            ids.push(tasks[i]._id);
                        }

                        Details.expandIds(ids, request.params.id, request.session.user, function (details) {

                            if (details) {

                                for (var i = 0, il = list.length; i < il; ++i) {

                                    if (details[list[i].id]) {

                                        list[i].detailsModified = details[list[i].id].modified;
                                        list[i].detailsModifiedBy = details[list[i].id].user;
                                        list[i].last = details[list[i].id].last;
                                    }
                                }
                            }

                            request.reply(list);
                        });
                    }
                    else {

                        request.reply(Hapi.Error.notFound());
                    }
                });
            }
            else {

                request.reply(err);
            }
        });
    }
};


// Update task properties

exports.post = {
    
    query: {
        
        position: Hapi.Types.Number().min(0)
    },
    
    schema: {

        title: Hapi.Types.String(),
        status: Hapi.Types.String().valid('open', 'pending', 'close'),
        participants: Hapi.Types.Array().includes(Hapi.Types.String()) //!! .emptyOk()
    },

    handler: function (request) {

        exports.load(request.params.id, request.session.user, true, function (task, err, project) {

            if (task) {

                if (Object.keys(request.payload).length > 0) {

                    if (request.query.position === undefined) {

                        // Task fields

                        var isInvalid = false;

                        if (request.payload.participants &&
                            request.payload.participants.length > 0) {

                            // Verify participants are members of the project

                            var error = null;
                            var index = {};

                            for (var p = 0, pl = request.payload.participants.length; p < pl; ++p) {

                                if (index[request.payload.participants[p]] !== true) {

                                    index[request.payload.participants[p]] = true;

                                    if (Project.isMember(project, request.payload.participants[p]) === false) {

                                        error = 'user ' + request.payload.participants[p] + ' is not a member of the Project';
                                        break;
                                    }
                                }
                                else {

                                    error = 'duplicate participant in list';
                                    break;
                                }
                            }

                            if (error) {

                                isInvalid = true;
                                request.reply(Hapi.Error.badRequest(error));
                            }
                        }

                        if (isInvalid === false) {

                            Db.update('task', task._id, Db.toChanges(request.payload), function (err) {

                                if (err === null) {

                                    Stream.update({ object: 'task', project: task.project, task: task._id }, request);
                                    request.reply({ status: 'ok' });
                                }
                                else {

                                    request.reply(err);
                                }
                            });
                        }
                    }
                    else {

                        request.reply(Hapi.Error.badRequest('Cannot include both position parameter and task object in body'));
                    }
                }
                else if (request.query.position !== null &&
                         request.query.position !== undefined) {        // Must test explicitly as value can be 0

                        // Set task position in list

                    Sort.set('task', task.project, 'project', request.params.id, request.query.position, function (err) {

                        if (err === null) {

                            Stream.update({ object: 'tasks', project: task.project }, request);
                            request.reply({ status: 'ok' });
                        }
                        else {

                            request.reply(err);
                        }
                    });
                }
                else {

                    request.reply(Hapi.Error.badRequest('Missing position parameter or task object in body'));
                }
            }
            else {

                request.reply(err);
            }
        });
    }
};


// Create new task

exports.put = {
    
    query: {

        position: Hapi.Types.Number(),
        suggestion: Hapi.Types.String()
    },

    schema: {

        title: Hapi.Types.String(),
        status: Hapi.Types.String().valid('open', 'pending', 'close')
    },

    handler: function (request) {

        Project.load(request.params.id, request.session.user, true, function (project, member, err) {

            if (project) {

                if (request.query.suggestion) {

                    // From suggestion

                    if (!request.rawBody) {

                        Suggestions.get(request.query.suggestion, function (suggestion) {

                            if (suggestion) {

                                var task = { title: suggestion.title, origin: { type: 'suggestion', suggestion: suggestion._id } };
                                addTask(task);
                            }
                            else {

                                request.reply(Hapi.Error.badRequest('Suggestion not found'));
                            }
                        });
                    }
                    else {

                        request.reply(Hapi.Error.badRequest('New task cannot have both body and suggestion id'));
                    }
                }
                else {

                    // From body

                    if (request.payload.title) {

                        addTask(request.payload);
                    }
                    else {

                        request.reply(Hapi.Error.badRequest('New task must include a title or a suggestion id'));
                    }
                }
            }
            else {

                request.reply(err);
            }
        });

        function addTask(task) {

            task.project = request.params.id;
            task.status = task.status || 'open';

            Db.insert('task', task, function (items, err) {

                if (err === null) {

                    Stream.update({ object: 'tasks', project: task.project }, request);
                    var result = { status: 'ok', id: items[0]._id };
                    request.created('task/' + items[0]._id);

                    if (request.query.position !== null &&
                        request.query.position !== undefined) {        // Must test explicitly as value can be 0

                        // Set task position in list

                        Sort.set('task', task.project, 'project', result.id, request.query.position, function (err) {

                            if (err === null) {

                                result.position = request.query.position;
                            }

                            request.reply(result);
                        });
                    }
                    else {

                        request.reply(result);
                    }
                }
                else {

                    request.reply(err);
                }
            });
        }
    }
};


// Delete a task

exports.del = {
    
    handler: function (request) {

        exports.load(request.params.id, request.session.user, true, function (task, err) {

            if (task) {

                Db.remove('task', task._id, function (err) {

                    if (err === null) {

                        Db.remove('task.details', task._id, function (err) { });

                        Stream.update({ object: 'tasks', project: task.project }, request);
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


// Load task from database and check for user rights

exports.load = function (taskId, userId, isWritable, callback) {

    Db.get('task', taskId, function (item, err) {

        if (item) {

            Project.load(item.project, userId, isWritable, function (project, member, err) {

                if (project) {

                    callback(item, null, project);
                }
                else {

                    callback(null, err, null);
                }
            });
        }
        else {

            if (err === null) {

                callback(null, Hapi.Error.notFound(), null);
            }
            else {

                callback(null, err, null);
            }
        }
    });
};


// Delete all tasks for a given project

exports.delProject = function (projectId, callback) {

    Db.removeCriteria('task', { project: projectId }, function (err) {

        if (err === null) {

            Db.removeCriteria('task.details', { project: projectId }, function (err) {

                // Delete the sort list

                Sort.del('task', projectId, callback);
            });
        }
        else {

            callback(err);
        }
    });
};


// List of tasks assigned to a user

exports.userTaskList = function (projectId, userId, callback) {

    Db.query('task', { project: projectId, participants: userId }, function (items, err) {

        if (err === null) {

            callback(items, null);
        }
        else {

            callback(null, err);
        }
    });
};


// Count of tasks in a given project

exports.count = function (projectId, callback) {

    Db.count('task', { project: projectId }, function (count, err) {

        if (err === null) {

            callback(count, null);
        }
        else {

            callback(null, err);
        }
    });
};


