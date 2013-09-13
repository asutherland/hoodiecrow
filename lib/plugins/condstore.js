"use strict";

module.exports = function(server){

    // Register capability, always usable
    server.registerCapability("CONDSTORE");
    if(Array.isArray(server.enableAvailable)){
        server.enableAvailable.push("CONDSTORE");
    }

    // set modseq values when message is created / initialized
    server.messageHandlers.push(function(connection, message, mailbox){
        mailbox.HIGHESTMODSEQ = (mailbox.HIGHESTMODSEQ || 0) + 1;
        message.MODSEQ = mailbox.HIGHESTMODSEQ;
    });

    server.allowedStatus.push("HIGHESTMODSEQ");

    // Override SELECT and EXAMINE to add
    var selectHandler = server.getCommandHandler("SELECT"),
        examineHandler = server.getCommandHandler("EXAMINE"),
        closeHandler = server.getCommandHandler("CLOSE"),
        condstoreHandler = function(prevHandler, connection, parsed, data, callback){
            var condstoreOption = false;
            if(parsed.attributes && Array.isArray(parsed.attributes[1])){
                for(var i = parsed.attributes[1].length - 1; i>=0; i--){
                    if(parsed.attributes[1][i]){
                        if(parsed.attributes[1][i].type == "ATOM" && parsed.attributes[1][i].value.toUpperCase() == "CONDSTORE"){
                            parsed.attributes[1].splice(i, 1);
                            condstoreOption = true;
                            break;
                        }
                    }
                }

                // remove parameter if not other memebers were left
                if(!parsed.attributes[1].length){
                    parsed.attributes.splice(1, 1);
                }
            }
            if(condstoreOption){
                connection.sessionCondstore = true;
            }else if("sessionCondstore" in connection){
                connection.sessionCondstore = false;
            }
            prevHandler(connection, parsed, data, callback);
        };

    server.setCommandHandler("SELECT", function(connection, parsed, data, callback){
        condstoreHandler(selectHandler, connection, parsed, data, callback);
    });

    server.setCommandHandler("EXAMINE", function(connection, parsed, data, callback){
        condstoreHandler(examineHandler, connection, parsed, data, callback);
    });

    server.setCommandHandler("CLOSE", function(connection, parsed, data, callback){
        if("sessionCondstore" in connection){
            connection.sessionCondstore = false;
        }
        closeHandler(connection, parsed, data, callback);
    });

    server.outputHandlers.push(function(connection, response, description, parsed, data, messages){
        if(!parsed){
            return;
        }

        // Increase modseq if flags are updated
        if(response.tag == parsed.tag &&
            response.command == "OK" &&
            (
                (parsed.command || "").toUpperCase() == "STORE" ||
                ((parsed.command || "").toUpperCase() == "UID" && (((parsed.attributes || [])[0] || {}).value || "").toUpperCase() == "STORE")
            )){
            // increase modseq
            [].concat(messages || []).forEach(function(message){
                connection.selectedMailbox.HIGHESTMODSEQ = (connection.selectedMailbox.HIGHESTMODSEQ || 0) + 1;
                message.MODSEQ = connection.selectedMailbox.HIGHESTMODSEQ;
            });
        }

        // Add CONDSTORE info if (CONDSTORE) option was used
        if(response.tag == parsed.tag &&
            response.command == "OK" &&
            (
                (parsed.command || "").toUpperCase() == "SELECT" ||
                (parsed.command || "").toUpperCase() == "EXAMINE"
            )){

            // (CONDSTORE) option was used, show notice
            if(connection.sessionCondstore){
                if(response.attributes.slice(-1)[0].type != "TEXT"){
                    response.attributes.push({
                        type: "TEXT",
                        value: "CONDSTORE is now enabled"
                    });
                }else{
                    response.attributes.slice(-1)[0].value +=", CONDSTORE is now enabled";
                }
            }

            // Send untagged info about highest modseq
            connection.send({
                tag: "*",
                command: "OK",
                attributes:[
                    {type:"SECTION",
                    section:[
                        {type: "ATOM", value:"HIGHESTMODSEQ"},
                        connection.selectedMailbox.HIGHESTMODSEQ || 0
                    ]}
                ]
            }, "CONDSTORE INFO", parsed, data);
        }
    });

};