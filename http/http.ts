///<reference path="./sha1.ts"/>

declare var chrome;

module Http{
    var _socket = chrome.socket;
    var _responseMap: {[key: string]: string;};
    initialize();

    function initialize(){
        if (!_socket)
            return;

// Http response code strings.
        _responseMap = {
            200: 'OK',
            301: 'Moved Permanently',
            304: 'Not Modified',
            400: 'Bad Request',
            401: 'Unauthorized',
            403: 'Forbidden',
            404: 'Not Found',
            413: 'Request Entity Too Large',
            414: 'Request-URI Too Long',
            500: 'Internal Server Error'
        };
    }

    function arrayBufferToString(buffer): string{
        var array = new Uint8Array(buffer);
        var str: string = '';
        for (var i = 0; i < array.length; ++i) {
            str += String.fromCharCode(array[i]);
        }
        return str;
    }

    function stringToArrayBuffer(srcString: string){
        var buffer = new ArrayBuffer(srcString.length);
        var bufferView = new Uint8Array(buffer);
        for (var i = 0; i < srcString.length; i++) {
            bufferView[i] = srcString.charCodeAt(i);
        }
        return buffer;
    }

    export class EventSource{
        _listeners: {[key: string]: Array<(any)=>void> };

        constructor(){
            this._listeners = {};
        }

        public addEventListener(type: string, callback: (any)=>void ){
            if (!this._listeners[type])
                this._listeners[type] = [];
            this._listeners[type].push(callback);
        }

        private _removeEventListener(type: string, callback: ()=>void ){
            if (!this._listeners[type])
                return;
            for (var i = this._listeners[type].length - 1; i >= 0; i--) {
                if (this._listeners[type][i] == callback) {
                    this._listeners[type].splice(i, 1);
                }
            }
        }

        public dispatchEvent(type: string, ...var_args: any[]): boolean{
            if (!this._listeners[type])
                return false;
            for (var i = 0; i < this._listeners[type].length; i++) {
                if (this._listeners[type][i].apply(
                    null,
                    var_args)) {
                    return true;
                }
            }
            return false;
        }
    }

    export class HttpServer extends EventSource{
        _readyState: number;
        _socketInfo: any;

        constructor(){
            super();
            this._readyState = 0;
        }

        public listen(port, ...opt_host: string[]){
            var t = this;
            _socket.create('tcp', {}, function(socketInfo) {
                t._socketInfo = socketInfo;
                var address = '0.0.0.0';
                if(opt_host.length > 0) address = opt_host[0];

                _socket.listen(t._socketInfo.socketId, address || '0.0.0.0', port, 50,
                    function(result) {
                        t._readyState = 1;
                        t._acceptConnection(t._socketInfo.socketId);
                    });
            });
        }

        private _acceptConnection(socketId){
            var t = this;
            _socket.accept(t._socketInfo.socketId, function(acceptInfo) {
                t._onConnection(acceptInfo);
                t._acceptConnection(socketId);
            });
        }

        private _onConnection(acceptInfo){
            this._readRequestFromSocket(acceptInfo.socketId);
        }

        private _readRequestFromSocket(socketId){
            var t = this;
            var requestData = '';
            var endIndex = 0;
            var onDataRead = function(readInfo) {
                // Check if connection closed.
                if (readInfo.resultCode <= 0) {
                    _socket.disconnect(socketId);
                    _socket.destroy(socketId);
                    return;
                }
                requestData += arrayBufferToString(readInfo.data).replace(/\r\n/g, '\n');
                // Check for end of request.
                endIndex = requestData.indexOf('\n\n', endIndex);
                if (endIndex == -1) {
                    endIndex = requestData.length - 1;
                    _socket.read(socketId, onDataRead);
                    return;
                }

                var headers = requestData.substring(0, endIndex).split('\n');
                var headerMap = {};
                // headers[0] should be the Request-Line
                var requestLine = headers[0].split(' ');
                headerMap['method'] = requestLine[0];
                headerMap['url'] = requestLine[1];
                headerMap['Http-Version'] = requestLine[2];
                for (var i = 1; i < headers.length; i++) {
                    requestLine = headers[i].split(':', 2);
                    if (requestLine.length == 2)
                        headerMap[requestLine[0]] = requestLine[1].trim();
                }
                var request = new HttpRequest(headerMap, socketId);
                t._onRequest(request);
            }
            _socket.read(socketId, onDataRead);
        }

        private _onRequest(request){
            var type = request.headers['Upgrade'] ? 'upgrade' : 'request';
            var keepAlive = request.headers['Connection'] == 'keep-alive';
            if (!this.dispatchEvent(type, request))
                request.close();
            else if (keepAlive)
                this._readRequestFromSocket(request._socketId);
        }
    }

    class HttpRequest extends EventSource{
        version: string;
        headers: any;
        _responseHeaders: any;
        headersSent: boolean;
        _socketId: any;
        _writes: number;
        bytesRemaining: number;
        _finished: boolean;
        readyState: number;
        extensionTypes = {
            'css': 'text/css',
            'html': 'text/html',
            'htm': 'text/html',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'js': 'text/javascript',
            'png': 'image/png',
            'svg': 'image/svg+xml',
            'txt': 'text/plain'};

        constructor(headers, socketId){
            super();

            this.version = 'HTTP/1.1';
            this.headers = headers;
            this._responseHeaders = {};
            this.headersSent = false;
            this._socketId = socketId;
            this._writes = 0;
            this.bytesRemaining = 0;
            this._finished = false;
            this.readyState = 1;
        }

        public close(){
            if (this.headers['Connection'] != 'keep-alive') {
                _socket.disconnect(this._socketId);
                _socket.destroy(this._socketId);
            }
            this._socketId = 0;
            this.readyState = 3;
        }

        public writeHead(responseCode, responseHeaders) {
            var headerString = this.version + ' ' + responseCode + ' ' +
                (_responseMap[responseCode] || 'Unknown');
            this._responseHeaders = responseHeaders;
            if (this.headers['Connection'] == 'keep-alive')
                responseHeaders['Connection'] = 'keep-alive';
            if (!responseHeaders['Content-Length'] && responseHeaders['Connection'] == 'keep-alive')
                responseHeaders['Transfer-Encoding'] = 'chunked';
            for (var i in responseHeaders) {
                headerString += '\r\n' + i + ': ' + responseHeaders[i];
            }
            headerString += '\r\n\r\n';
            this._write(stringToArrayBuffer(headerString));
        }

        public write(data) {
            if (this._responseHeaders['Transfer-Encoding'] == 'chunked') {
                var newline = '\r\n';
                var byteLength = (data instanceof ArrayBuffer) ? data.byteLength : data.length;
                var chunkLength = byteLength.toString(16).toUpperCase() + newline;
                var buffer = new ArrayBuffer(chunkLength.length + byteLength + newline.length);
                var bufferView = new Uint8Array(buffer);
                for (var i = 0; i < chunkLength.length; i++)
                    bufferView[i] = chunkLength.charCodeAt(i);
                if (data instanceof ArrayBuffer) {
                    bufferView.set(new Uint8Array(data), chunkLength.length);
                } else {
                    for (var i = 0; i < data.length; i++)
                        bufferView[chunkLength.length + i] = data.charCodeAt(i);
                }
                for (var i = 0; i < newline.length; i++)
                    bufferView[chunkLength.length + byteLength + i] = newline.charCodeAt(i);
                data = buffer;
            } else if (!(data instanceof ArrayBuffer)) {
                data = stringToArrayBuffer(data);
            }
            this._write(data);
        }

        public end(opt_data) {
            if (opt_data)
                this.write(opt_data);
            if (this._responseHeaders['Transfer-Encoding'] == 'chunked')
                this.write('');
            this._finished = true;
            this._checkFinished();
        }

        public serveUrl(url){
            var t = this;
            var xhr = new XMLHttpRequest();
            xhr.onloadend = function() {
                var type = 'text/plain';
                if (this.getResponseHeader('Content-Type')) {
                    type = this.getResponseHeader('Content-Type');
                } else if (url.indexOf('.') != -1) {
                    var extension = url.substr(url.indexOf('.') + 1);
                    type = t.extensionTypes[extension] || type;
                }

                var contentLength = this.getResponseHeader('Content-Length');
                if (xhr.status == 200)
                    contentLength = (this.response && this.response.byteLength) || 0;
                t.writeHead(this.status, {
                    'Content-Type': type,
                    'Content-Length': contentLength});
                t.end(this.response);
            };
            xhr.open('GET', url, true);
            xhr.responseType = 'arraybuffer';
            xhr.send();
        }

        private _write(array){
            var t = this;
            this.bytesRemaining += array.byteLength;
            _socket.write(this._socketId, array, function(writeInfo) {
                if (writeInfo.bytesWritten < 0) {
                    console.error('Error writing to socket, code '+writeInfo.bytesWritten);
                    return;
                }
                t.bytesRemaining -= writeInfo.bytesWritten;
                t._checkFinished();
            });
        }

        private _checkFinished(){
            if (!this._finished || this.bytesRemaining > 0)
                return;
            this.close();
        }
    }

    export class WebSocketServer extends EventSource{
        constructor(httpServer){
            super();
            httpServer.addEventListener('upgrade', this._upgradeToWebSocket.bind(this));
        }

        private _upgradeToWebSocket(request): boolean{
            if (request.headers['Upgrade'] != 'websocket' ||
                !request.headers['Sec-WebSocket-Key']) {
                return false;
            }


            if (this.dispatchEvent('request', new WebSocketRequest(request))) {
                if (request._socketId)
                    request.reject();
                return true;
            }

            return false;
        }
    }

    class WebSocketRequest extends HttpRequest{
        constructor(httpRequest){
            super(httpRequest.headers, httpRequest._socketId);
            httpRequest._socketId = 0;
        }

        public accept(){
            // Construct WebSocket response key.
            var clientKey = this.headers['Sec-WebSocket-Key'];
            var toArray = function(str) {
                var a = [];
                for (var i = 0; i < str.length; i++) {
                    a.push(str.charCodeAt(i));
                }
                return a;
            }
            var toString = function(a) {
                var str = '';
                for (var i = 0; i < a.length; i++) {
                    str += String.fromCharCode(a[i]);
                }
                return str;
            }

            // Magic string used for http connection key hashing:
            // http://en.wikipedia.org/wiki/WebSocket
            var magicStr = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

            // clientKey is base64 encoded key.
            clientKey += magicStr;
            var sha1 = new Sha1();
            sha1.reset();
            var array = toArray(clientKey)
            sha1.update(array, array.length);
            var responseKey = btoa(toString(sha1.digest()));
            var responseHeader = {
                'Upgrade': 'websocket',
                'Connection': 'Upgrade',
                'Sec-WebSocket-Accept': responseKey};
            if (this.headers['Sec-WebSocket-Protocol'])
                responseHeader['Sec-WebSocket-Protocol'] = this.headers['Sec-WebSocket-Protocol'];
            this.writeHead(101, responseHeader);
            var socket = new WebSocketServerSocket(this._socketId);
            // Detach the socket so that we don't use it anymore.
            this._socketId = 0;
            return socket;
        }

        public reject(){
            this.close();
        }
    }

    class WebSocketServerSocket extends EventSource{
        _socketId: any;
        readyState: number;

        constructor(socketId){
            super();
            this._socketId = socketId;
            this._readFromSocket();
        }

        public send(data){
            this._sendFrame(1, data);
        }

        public close(){
            this._sendFrame(8, null);
            this.readyState = 2;
        }

        private _readFromSocket(){
            var t = this;
            var data = [];
            var message = '';
            var fragmentedOp = 0;
            var fragmentedMessage = '';

            var onDataRead = function(readInfo) {
                if (readInfo.resultCode <= 0) {
                    t._close();
                    return;
                }
                if (!readInfo.data.byteLength) {
                    _socket.read(t._socketId, onDataRead);
                    return;
                }

                var a = new Uint8Array(readInfo.data);
                for (var i = 0; i < a.length; i++)
                    data.push(a[i]);

                while (data.length) {
                    var length_code = -1;
                    var data_start = 6;
                    var mask;
                    var fin = (data[0] & 128) >> 7;
                    var op = data[0] & 15;

                    if (data.length > 1)
                        length_code = data[1] & 127;
                    if (length_code > 125) {
                        if ((length_code == 126 && data.length > 7) ||
                            (length_code == 127 && data.length > 14)) {
                            if (length_code == 126) {
                                length_code = data[2] * 256 + data[3];
                                mask = data.slice(4, 8);
                                data_start = 8;
                            } else if (length_code == 127) {
                                length_code = 0;
                                for (var i = 0; i < 8; i++) {
                                    length_code = length_code * 256 + data[2 + i];
                                }
                                mask = data.slice(10, 14);
                                data_start = 14;
                            }
                        } else {
                            length_code = -1; // Insufficient data to compute length
                        }
                    } else {
                        if (data.length > 5)
                            mask = data.slice(2, 6);
                    }

                    if (length_code > -1 && data.length >= data_start + length_code) {
                        var decoded = data.slice(data_start, data_start + length_code).map(function(byte, index) {
                            return byte ^ mask[index % 4];
                        });
                        data = data.slice(data_start + length_code);
                        if (fin && op > 0) {
                            // Unfragmented message.
                            if (!t._onFrame(op, arrayBufferToString(decoded)))
                                return;
                        } else {
                            // Fragmented message.
                            fragmentedOp = fragmentedOp || op;
                            fragmentedMessage += arrayBufferToString(decoded);
                            if (fin) {
                                if (!t._onFrame(fragmentedOp, fragmentedMessage))
                                    return;
                                fragmentedOp = 0;
                                fragmentedMessage = '';
                            }
                        }
                    } else {
                        break; // Insufficient data, wait for more.
                    }
                }
                _socket.read(t._socketId, onDataRead);
            };
            _socket.read(this._socketId, onDataRead);
        }

        private _onFrame(op, data){
            if (op == 1) {
                this.dispatchEvent('message', {'data': data});
            } else if (op == 8) {
                // A close message must be confirmed before the http is closed.
                if (this.readyState == 1) {
                    this._sendFrame(8, null);
                } else {
                    this._close();
                    return false;
                }
            }
            return true;
        }

        private _sendFrame(op, data){
            var t = this;
            var WebsocketFrameString = function(op, str) {
                var length = str.length;
                if (str.length > 65535)
                    length += 10;
                else if (str.length > 125)
                    length += 4;
                else
                    length += 2;
                var lengthBytes = 0;
                var buffer = new ArrayBuffer(length);
                var bv = new Uint8Array(buffer);
                bv[0] = 128 | (op & 15); // Fin and type text.
                bv[1] = str.length > 65535 ? 127 :
                    (str.length > 125 ? 126 : str.length);
                if (str.length > 65535)
                    lengthBytes = 8;
                else if (str.length > 125)
                    lengthBytes = 2;
                var len = str.length;
                for (var i = lengthBytes - 1; i >= 0; i--) {
                    bv[2 + i] = len & 255;
                    len = len >> 8;
                }
                var dataStart = lengthBytes + 2;
                for (var i = 0; i < str.length; i++) {
                    bv[dataStart + i] = str.charCodeAt(i);
                }
                return buffer;
            };

            var array = WebsocketFrameString(op, data || '');
            _socket.write(this._socketId, array, function(writeInfo) {
                if (writeInfo.resultCode < 0 ||
                    writeInfo.bytesWritten !== array.byteLength) {
                    t._close();
                }
            });
        }

        private _close(){
            chrome.socket.disconnect(this._socketId);
            chrome.socket.destroy(this._socketId);
            this.readyState = 3;
            this.dispatchEvent('close');
        }
    }
}