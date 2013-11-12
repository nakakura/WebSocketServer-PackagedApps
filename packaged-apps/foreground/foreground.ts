///<reference path="./websocket_manager.ts"/>

declare var chrome;

chrome.runtime.getBackgroundPage(function(bgPage) {
    if(bgPage.webSocketManager !== undefined){
        var socketId = bgPage.webSocketManager.socketId();
        chrome.socket.destroy(socketId);
    }

    bgPage.webSocketManager = new WebSocketManager(9999);
    bgPage.webSocketManager.removeAllObservers();
    bgPage.webSocketManager.startListening();

});