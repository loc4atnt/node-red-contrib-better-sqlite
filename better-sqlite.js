module.exports = function (RED) {
    "use strict";
    var reconnect = RED.settings.betterSqliteReconnectTime || 20000;
    var poolManager = require('./poolManager.js');
    /**
     * Runs a query against a database and sends the result as a message.
     * @param {string} query - the query to run
     * @param {object} pool - the pool to use for the query
     * @param {object} node - the node that is calling this function
     * @param {object} msg - the message to send the result in
     */
    function all(query, pool, node, msg) {
        let method = "all";
        const countStatement = query.trim().split(";").filter(n => n).length;
        const upperQuery = query.toUpperCase();

        if (countStatement === 1 && (
            upperQuery.includes("INSERT ") || 
            upperQuery.includes("UPDATE ") || 
            upperQuery.includes("DELETE ") ||
            upperQuery.includes("CREATE ") ||
            upperQuery.includes("DROP ") ||
            upperQuery.includes("ALTER ")
        )) {
            method = "run";
        } else if (countStatement > 1) {
            method = "exec";
        }
        //node.log(method + " " + countStatement + " " + query );   
        poolManager.execOnPool(pool, function (db) {
            try {
                //node.log(msg.topic);
                if (method === "exec") {
                    db.exec(query);
                    msg.payload = [];
                } else {
                    const row = db.prepare(query)[method]()
                    //node.log(row);
                    msg.payload = row;
                }
                node.send(msg);
            } catch (err) {
                node.error(err, msg);
            }
        });
    }

    /**
     * Retrieves or initializes the SQLite pool manager in the global context.
     * @param {object} globalContext - The context in which to store the pool manager.
     * @param {boolean} [reset=false] - Whether to reset the pool manager.
     * @returns {object} The pool manager from the global context.
     */
    function getPoolManager(globalContext, reset = false) {
        const CONTEXT_NAME = '_sqlitePool';
        if (!globalContext.get(CONTEXT_NAME || reset === true)) {
            globalContext.set(CONTEXT_NAME, {});
        }
        return globalContext.get(CONTEXT_NAME);
    }
    /**
     * Manage configuration
     * @param {*} n 
     */
    function SqliteNodeDB(n) {
        RED.nodes.createNode(this, n);
        var globalContext = this.context().global;
        let POOLMANAGER = getPoolManager(globalContext);
        this.dbname = n.db;
        this.mod = n.mode;
        this.options = {};
        if (n.mode === "RWC") {
            //default
        }
        if (n.mode === "RW") {
            this.options.fileMustExist = true
        }
        if (n.mode === "RO") {
            this.options.readonly = true;
            this.options.fileMustExist = true
        }
        var node = this;

        node.doConnect = function () {
            if (node.pool) { return; }
            node.pool = poolManager.getPool(POOLMANAGER, node.dbname, node.options);
            node.pool.acquire()
                .then(db => {
                    if (node.tick) { clearTimeout(node.tick); }
                    //node.log("pool " + node.dbname + " ok");
                    db.release();
                })
                .catch(err => {
                    node.error("failed to open " + node.dbname, err);
                    node.tick = setTimeout(function () { node.doConnect(); }, reconnect);
                })
        }

        node.on('close', function (done) {
            if (node.tick) { clearTimeout(node.tick); }
            // if (node.pool) { node.pool.close(done()); }
            //else { done(); }
            done();
        });
    }
    RED.nodes.registerType("better-sqlitedb", SqliteNodeDB);

    /**
     * Manage runtime with message
     * @param {*} n 
     */
    function SqliteNodeIn(n) {
        RED.nodes.createNode(this, n);
        this.mydb = n.mydb;
        this.sqlquery = n.sqlquery || "msg.topic";
        this.sql = n.sql;
        this.mydbConfig = RED.nodes.getNode(this.mydb);
        var node = this;
        node.status({});

        if (node.mydbConfig) {
            node.mydbConfig.doConnect();
            node.status({ fill: "green", shape: "dot", text: this.mydbConfig.mod });
            var bind = [];

            var doQuery = function (msg) {
                bind = []
                if (node.sqlquery == "msg.topic") {
                    if (typeof msg.topic === 'string') {
                        if (msg.topic.length > 0) {
                            if (Array.isArray(msg.payload)) {
                                if (msg.payload.length === (msg.topic.split('$').length - 1)) { bind = msg.payload; }
                                else { bind = []; }
                            }
                            all(msg.topic, node.mydbConfig.pool, node, msg);
                        }
                    }
                    else {
                        node.error("msg.topic : the query is not defined as a string", msg);
                        node.status({ fill: "red", shape: "dot", text: "msg.topic error" });
                    }
                }
                if (node.sqlquery == "batch") {
                    if (typeof msg.topic === 'string') {
                        if (msg.topic.length > 0) {
                            poolManager.execOnPool(node.mydbConfig.pool, function (db) {
                                try {
                                    db.exec(msg.topic)
                                    msg.payload = [];
                                    node.send(msg);
                                }
                                catch (err) { node.error(err, msg); }
                            });
                        }
                        else {
                            node.error("msg.topic : the query is not defined as string", msg);
                            node.status({ fill: "red", shape: "dot", text: "msg.topic error" });
                        }
                    }
                }
                if (node.sqlquery == "fixed") {
                    if (typeof node.sql === 'string') {
                        if (node.sql.length > 0) {
                            all(node.sql, node.mydbConfig.pool, node, msg);
                        }
                    }
                    else {
                        if (node.sql === null || node.sql == "") {
                            node.error("SQL statement config not set up", msg);
                            node.status({ fill: "red", shape: "dot", text: "SQL config not set up" });
                        }
                    }
                }
                if (node.sqlquery == "prepared") {
                    if (typeof node.sql === 'string' && typeof msg.params !== "undefined" && typeof msg.params === "object") {
                        if (node.sql.length > 0) {
                            all(msg.params, node.mydbConfig.pool, node, msg);
                        }
                    }
                    else {
                        if (node.sql === null || node.sql == "") {
                            node.error("Prepared statement config not set up", msg);
                            node.status({ fill: "red", shape: "dot", text: "Prepared statement not set up" });
                        }
                        if (typeof msg.params == "undefined") {
                            node.error("msg.params not passed");
                            node.status({ fill: "red", shape: "dot", text: "msg.params not defined" });
                        }
                        else if (typeof msg.params != "object") {
                            node.error("msg.params not an object");
                            node.status({ fill: "red", shape: "dot", text: "msg.params not an object" });
                        }
                    }
                }
            }
            node.on("input", function (msg) {
                if (msg.hasOwnProperty("extension")) {
                    poolManager.execOnPool(node.mydbConfig.pool, function (db) {
                        try {
                            db.loadExtension(msg.extension)
                            doQuery(msg);
                        }
                        catch (err) { node.error(err, msg); }
                    });
                }
                else { doQuery(msg); }
            });
        }
        else {
            node.error("Sqlite database not configured");
        }
    }
    RED.nodes.registerType("better-sqlite", SqliteNodeIn);
}
