///<reference path="./http/http.ts"/>

class WebSocketManager{
    _port: number;
    _isServer: boolean;
    _observers: Array<()=>void>;
    _webServer: any;
    _webSockServer: any;

    constructor(port: number){
        this._port = port;
        this._isServer = false;
    }

    public startListening(){
        if (Http.HttpServer && Http.WebSocketServer) {
            // Listen for HTTP connections.
            this._webServer = new Http.HttpServer();
            this._webSockServer = new Http.WebSocketServer(this._webServer);
            this._webServer.listen(this._port);
            this._isServer = true;

            this._webServer.addEventListener('request', function(req) {
                var url = req.headers.url;
                if (url == '/')
                    url = '/index.html';
                // Serve the pages of this chrome application.
                req.serveUrl(url);
                return true;
            });

            // A list of connected websockets.
            var connectedSockets = [];

            this._webSockServer.addEventListener('request', function(req) {
                console.log('Client connected');
                var socket = req.accept();
                connectedSockets.push(socket);

                // When a message is received on one socket, rebroadcast it on all
                // connected sockets.
                socket.addEventListener('message', function(e) {
                    console.log(e.data);
                    for (var i = 0; i < connectedSockets.length; i++)
                        connectedSockets[i].send(e.data);
                });

                // When a socket is closed, remove it from the list of connected sockets.
                socket.addEventListener('close', function() {
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
    }

    public addObserver(observer: ()=>void){
        this._observers.push(observer);
    }

    public removeObserver(observer: ()=>void){

    }

    public removeAllObservers(){
        this._observers = [];
    }

    public socketId(){
        return this._webServer.socketId();
//        this._webServer.close();
    }
}

