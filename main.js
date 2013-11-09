///<reference path="http/http.ts"/>
var WebSocketManager = (function () {
    function WebSocketManager() {
        this._port = 9999;
        this._isServer = false;
    }
    WebSocketManager.prototype.startListening = function () {
        if (Http.HttpServer && Http.WebSocketServer) {
            // Listen for HTTP connections.
            var server = new Http.HttpServer();
            var wsServer = new Http.WebSocketServer(server);
            server.listen(this._port);
            this._isServer = true;

            server.addEventListener('request', function (req) {
                var url = req.headers.url;
                if (url == '/')
                    url = '/index.html';

                // Serve the pages of this chrome application.
                req.serveUrl(url);
                return true;
            });

            // A list of connected websockets.
            var connectedSockets = [];

            wsServer.addEventListener('request', function (req) {
                console.log('Client connected');
                var socket = req.accept();
                connectedSockets.push(socket);

                // When a message is received on one socket, rebroadcast it on all
                // connected sockets.
                socket.addEventListener('message', function (e) {
                    console.log(e.data);
                    for (var i = 0; i < connectedSockets.length; i++)
                        connectedSockets[i].send(e.data);
                });

                // When a socket is closed, remove it from the list of connected sockets.
                socket.addEventListener('close', function () {
                    console.log('Client disconnected');
                    for (var i = 0; i < connectedSockets.length; i++) {
                        if (connectedSockets[i] == socket) {
                            connectedSockets.splice(i, 1);
                            break;
                        }
                    }
                });
                return true;
            });
        }
    };
    return WebSocketManager;
})();

var websocketmanager = new WebSocketManager();
websocketmanager.startListening();
//# sourceMappingURL=main.js.map
