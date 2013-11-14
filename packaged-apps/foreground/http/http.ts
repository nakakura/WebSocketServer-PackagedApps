///<reference path="./sha1.ts"/>

declare var chrome;

module Http{
    var _socket = chrome.socket;
    var _responseMap: {[key: string]: string;};
    initialize();

    function initialize(): void{
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

    function arrayBufferToString(buffer: Array<number>): string{
        var array: Uint8Array = new Uint8Array(buffer);
        var str: string = '';
        for (var i = 0; i < array.length; ++i) {
            str += String.fromCharCode(array[i]);
        }
        return str;
    }

    function stringToArrayBuffer(srcString: string): ArrayBuffer{
        var buffer: ArrayBuffer = new ArrayBuffer(srcString.length);
        var bufferView: Uint8Array = new Uint8Array(buffer);
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

        public addEventListener(type: string, callback: (any)=>void ): void{
            if (!this._listeners[type])
                this._listeners[type] = [];
            this._listeners[type].push(callback);
        }

        private _removeEventListener(type: string, callback: ()=>void ): void{
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
        _socketInfo: {[key: string]: number};

        constructor(){
            super();
            this._readyState = 0;
        }

        public listen(port: number, ...opt_host: string[]): void{
            var t: HttpServer = this;
            _socket.create('tcp', {}, function(socketInfo) {
                t._socketInfo = socketInfo;
                var address: string = '0.0.0.0';
                if(opt_host.length > 0) address = opt_host[0];

                _socket.listen(t._socketInfo['socketId'], address || '0.0.0.0', port, 50,
                    function(result) {
                        t._readyState = 1;
                        t._acceptConnection(t._socketInfo['socketId']);
                    });
            });
        }

        private _acceptConnection(socketId: number): void{
            var t: HttpServer = this;
            _socket.accept(t._socketInfo['socketId'], function(acceptInfo) {
                t._onConnection(acceptInfo);
                t._acceptConnection(socketId);
            });
        }

        private _onConnection(acceptInfo: {[key:string]: number}): void{
            this._readRequestFromSocket(acceptInfo['socketId']);
        }

        private _readRequestFromSocket(socketId: number): void{
            var self: HttpServer = this;
            var requestData: string = '';
            var endIndex: number = 0;
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

                var headers: string[] = requestData.substring(0, endIndex).split('\n');
                var headerMap: {[key: string]: string} = {};
                // headers[0] should be the Request-Line
                var requestLine: string[] = headers[0].split(' ');
                headerMap['method'] = requestLine[0];
                headerMap['url'] = requestLine[1];
                headerMap['Http-Version'] = requestLine[2];
                for (var i = 1; i < headers.length; i++) {
                    requestLine = headers[i].split(':', 2);
                    if (requestLine.length == 2)
                        headerMap[requestLine[0]] = requestLine[1].trim();
                }
                var request: HttpRequest = new HttpRequest(headerMap, socketId);
                self._onRequest(request);
            }
            _socket.read(socketId, onDataRead);
        }

        private _onRequest(request: HttpRequest): void{
            var type: string = request.headers['Upgrade'] ? 'upgrade' : 'request';
            var keepAlive: boolean = request.headers['Connection'] == 'keep-alive';
            if (!this.dispatchEvent(type, request))
                request.close();
            else if (keepAlive)
                this._readRequestFromSocket(request._socketId);
        }

        public socketId(): number{
            return this._socketInfo['socketId'];
        }
    }

    class HttpRequest extends EventSource{
        version: string;
        headers: {[key: string]: string};
        _responseHeaders: {[key: string]: string};
        headersSent: boolean;
        _socketId: number;
        _writes: number;
        bytesRemaining: number;
        _finished: boolean;
        readyState: number;
        extensionTypes: {[key: string]: string} =
        {
            'css': 'text/css',
            'html': 'text/html',
            'htm': 'text/html',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'js': 'text/javascript',
            'png': 'image/png',
            'svg': 'image/svg+xml',
            'txt': 'text/plain'
        };

        constructor(headers: {[key: string]: string}, socketId: number){
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

        public close(): void{
            if (this.headers['Connection'] != 'keep-alive') {
                _socket.disconnect(this._socketId);
                _socket.destroy(this._socketId);
            }
            this._socketId = 0;
            this.readyState = 3;
        }

        public writeHead(responseCode: number, responseHeaders: any): void{
            var headerString: string = this.version + ' ' + responseCode + ' ' +
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

        public write(data: any): void{
            if (this._responseHeaders['Transfer-Encoding'] == 'chunked') {
                var newline: string = '\r\n';
                var byteLength: number = (data instanceof ArrayBuffer) ? data.byteLength : data.length;
                var chunkLength: string = byteLength.toString(16).toUpperCase() + newline;
                var buffer: ArrayBuffer = new ArrayBuffer(chunkLength.length + byteLength + newline.length);
                var bufferView: Uint8Array = new Uint8Array(buffer);
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

        public end(opt_data: ArrayBuffer): void{
            if (opt_data)
                this.write(opt_data);
            if (this._responseHeaders['Transfer-Encoding'] == 'chunked')
                this.write('');
            this._finished = true;
            this._checkFinished();
        }

        public serveUrl(url: string): void{
            var t: HttpRequest = this;
            var xhr: XMLHttpRequest = new XMLHttpRequest();
            xhr.onloadend = function() {
                var type: string = 'text/plain';
                if (this.getResponseHeader('Content-Type')) {
                    type = this.getResponseHeader('Content-Type');
                } else if (url.indexOf('.') != -1) {
                    var extension: string = url.substr(url.indexOf('.') + 1);
                    type = t.extensionTypes[extension] || type;
                }

                var contentLength: number = this.getResponseHeader('Content-Length');
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

        private _write(array: ArrayBuffer): void{
            var t: HttpRequest = this;
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

        private _checkFinished(): void{
            if (!this._finished || this.bytesRemaining > 0)
                return;
            this.close();
        }
    }

    export class WebSocketServer extends EventSource{
        constructor(httpServer: HttpServer){
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
        constructor(httpRequest: HttpRequest){
            super(httpRequest.headers, httpRequest._socketId);
            httpRequest._socketId = 0;
        }

        public accept(): WebSocketServerSocket{
            // Construct WebSocket response key.
            var clientKey: string = this.headers['Sec-WebSocket-Key'];
            var toArray: (string)=>number[] = function(str: string) {
                var a: number[] = [];
                for (var i = 0; i < str.length; i++) {
                    a.push(str.charCodeAt(i));
                }
                return a;
            }
            var toString: (a: number[])=>string = function(a) {
                var str: string = '';
                for (var i = 0; i < a.length; i++) {
                    str += String.fromCharCode(a[i]);
                }
                return str;
            }

            // Magic string used for http connection key hashing:
            // http://en.wikipedia.org/wiki/WebSocket
            var magicStr: string = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

            // clientKey is base64 encoded key.
            clientKey += magicStr;
            var sha1: Sha1 = new Sha1();
            sha1.reset();
            var array: number[] = toArray(clientKey)
            sha1.update(array, array.length);
            var responseKey: string = btoa(toString(sha1.digest()));
            var responseHeader = {
                'Upgrade': 'websocket',
                'Connection': 'Upgrade',
                'Sec-WebSocket-Accept': responseKey};
            if (this.headers['Sec-WebSocket-Protocol'])
                responseHeader['Sec-WebSocket-Protocol'] = this.headers['Sec-WebSocket-Protocol'];
            this.writeHead(101, responseHeader);
            var socket: WebSocketServerSocket = new WebSocketServerSocket(this._socketId);
            // Detach the socket so that we don't use it anymore.
            this._socketId = 0;
            return socket;
        }

        public reject(){
            this.close();
        }
    }

    class WebSocketServerSocket extends EventSource{
        _socketId: number;
        readyState: number;

        constructor(socketId: number){
            super();
            this._socketId = socketId;
            this._readFromSocket();
        }

        public send(data: string): void{
            this._sendFrame(1, data);
        }

        public close(): void{
            this._sendFrame(8, null);
            this.readyState = 2;
        }

        private _readFromSocket(): void{
            var t: WebSocketServerSocket = this;
            var data: number[] = [];
            var message: string = '';
            var fragmentedOp: number = 0;
            var fragmentedMessage: string = '';

            var onDataRead = function(readInfo) {
                if (readInfo.resultCode <= 0) {
                    t._close();
                    return;
                }
                if (!readInfo.data.byteLength) {
                    _socket.read(t._socketId, onDataRead);
                    return;
                }

                var a: Uint8Array = new Uint8Array(readInfo.data);
                for (var i = 0; i < a.length; i++)
                    data.push(a[i]);

                while (data.length) {
                    var length_code: number = -1;
                    var data_start: number = 6;
                    var mask: number[];
                    var fin: number = (data[0] & 128) >> 7;
                    var op: number = data[0] & 15;

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
                        var decoded: number[] = data.slice(data_start, data_start + length_code).map(function(byte, index) {
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

        private _onFrame(op: number, data: string): boolean{
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

        private _sendFrame(op: number, data: string){
            var t: WebSocketServerSocket = this;
            var WebsocketFrameString: (number, string)=>ArrayBuffer = function(op: number, str: string) {
                var length: number = str.length;
                if (str.length > 65535)
                    length += 10;
                else if (str.length > 125)
                    length += 4;
                else
                    length += 2;
                var lengthBytes: number = 0;
                var buffer: ArrayBuffer = new ArrayBuffer(length);
                var bv: Uint8Array = new Uint8Array(buffer);
                bv[0] = 128 | (op & 15); // Fin and type text.
                bv[1] = str.length > 65535 ? 127 :
                    (str.length > 125 ? 126 : str.length);
                if (str.length > 65535)
                    lengthBytes = 8;
                else if (str.length > 125)
                    lengthBytes = 2;
                var len: number = str.length;
                for (var i = lengthBytes - 1; i >= 0; i--) {
                    bv[2 + i] = len & 255;
                    len = len >> 8;
                }
                var dataStart: number = lengthBytes + 2;
                for (var i = 0; i < str.length; i++) {
                    bv[dataStart + i] = str.charCodeAt(i);
                }
                return buffer;
            };

            var array: ArrayBuffer = WebsocketFrameString(op, data || '');
            _socket.write(this._socketId, array, function(writeInfo: {[key: string]: number}) {
                if (writeInfo['resultCode'] < 0 ||
                    writeInfo['bytesWritten'] !== array.byteLength) {
                    t._close();
                }
            });
        }

        private _close(): void{
            chrome.socket.disconnect(this._socketId);
            chrome.socket.destroy(this._socketId);
            this.readyState = 3;
            this.dispatchEvent('close');
        }
    }
}