/**
 * Parse HTTP requests and responses.
 * When we receive data we may receive either HTTP responses from previous requests
 * that we have sent or we may receive HTTP requests if we are acting as a Web Server.
 * This module provides a solution for parsing such data.
 * 
 * It is based on the notion of streams.
 * 
 * Here is a Response example:
 * var HTTPParser = require("httpparser");
 * function responseHandler(response) {
 * // Response contains:
 * // - headers
 * // - statusCode 
 *    on("data", function(data) {
 *    	// Handle data
 *    });
 *    on("end", function() {
 *       // handle end
 *    });
 * }
 * var parser = new HTTPParser("response", responseHandler);
 * // responseData read from socket ...
 * parser.write(responseData);
 * parser.end();
 * 
 * 
 * 
 * Here is a Request example:
 * var HTTPParser = require("httpparser");
 * function requestHandler(request) {
 * // Response contains:
 * // - headers
 * // - method
 *    on("data", function(data) {
 *    	// Handle data
 *    });
 *    on("end", function() {
 *       // handle end
 *    });
 * }
 * var parser = new HTTPParser("request", requestHandler);
 * // requestData read from socket ...
 * parser.write(requestData);
 * parser.end();
 * 
 * The first implementation of the parser accumulated all the data that was passed into it until
 * we were told that there was going to be no more.  At that point we had ALL the data received
 * from the client and could parse it as a whole.  Unfortunately this wasn't going to work.
 * Not only were we having to accumulate data, but there was an important semantic problem.
 * When data is sent over a connection, the sender doesn't "end" the socket connection after it
 * has sent its request or response.  As such, there is no "end of stream" marker at the network
 * level.  The HTTP data itself defines when the data ends.
 * 
 * For example ... a request HTTP may be:
 * 
 * GET /path HTTP/1.0<CRLF>
 * header1: value1<CRLF>
 * header2: value2<CRLF>
 * <CRLF>
 * ... don't care ...
 * 
 * or it might be
 * 
 * POST /path HTTP/1.0<CRLF>
 * header1: value1<CRLF>
 * Content-Length: <size>
 * header2: value2<CRLF>
 * <CRLF>
 * data ......
 * ... don't care ...
 * 
 * 
 * In our story now ... the parser will be called **repeatedly**.   Each time it is called, it will receive a bit more data.
 * 
 */
/* globals require, log, module */
var Stream = require("stream");


/**
 * Given a line of text that is expected to be "\r\n" delimited, return an object that
 * contains the first line and the remainder.
 * @param data The input text to parse.
 * @returns An object that contains
 * {
 *    line: <The line of text up to the first \r\n>
 *    remainder: The remainder of the data after the first \r\n or the whole
 *       data if there is no first \r\n.
 * }
 */
function getLine(data) {
	var i = data.indexOf("\r\n");
	if (i === -1) { // If we didn't find a terminator, then no lines and remainder is all.
		return {
			line: null,
			remainder: data
		};
	}
	return {
		line: data.substr(0, i),
		remainder: data.substr(i+2)
	};
} // getLine


var STATE = {
	START_REQUEST: 1,
	START_RESPONSE: 2,
	HEADERS: 3,
	BODY: 4,
	END: 5
};
	

function httpparser(type, handler) {
	var networkStream = new Stream();
	var httpStream = new Stream();
	httpStream.reader.headers = {};
	var unconsumedData = "";
	var bodyLeftToRead;
	var state;
	if (type == "request") {
		state = STATE.START_REQUEST;
	} else if (type == "response") {
		state = STATE.START_RESPONSE;
	} else {
		throw new Error("ERROR: Unknown type on httpparser: " + type);
	}
	
	function consume(dataToProcess) {
		var line = getLine(dataToProcess);
		while (line.line !== null) {
			log("http parsing: " + line.line);
			
			if (state == STATE.START_RESPONSE) {
				// A header line is of the form <protocols>' '<code>' '<message>
				//                                  0          1         2					
				var splitData = line.line.split(" ");
				httpStream.reader.httpStatus = splitData[1];
				log("httpStatus = " + httpStream.reader.httpStatus);
				// We have finished with the start line ...
				state = STATE.HEADERS;
			} // End of in STATE.START_RESPONSE
			else if (state == STATE.START_REQUEST) {
				var splitData = line.line.split(" ");
				httpStream.reader.method = splitData[0];
				httpStream.reader.path = splitData[1];
				log("http Method: " + httpStream.reader.method + ", path: " + httpStream.reader.path);
				// We have finished with the start line ...
				state = STATE.HEADERS;
			}
			else if (state == STATE.HEADERS) {
		// Between the headers and the body of an HTTP response is an empty line that marks the end of
		// the HTTP headers and the start of the body.  Thus we can find a line that is empty and, if it
		// is found, we switch to STATE.BODY.  Otherwise, we found a header line of the format:
		// <name>':_'<value>
				if (line.line.length === 0) {
					log("End of headers\n" + JSON.stringify(httpStream.reader.headers));
					// We are about to start the body ... BUT ... at this point we only have a body
					// if we have a contentLength.
					if (httpStream.reader.headers["Content-Length"] !== undefined) {
						bodyLeftToRead = Number(httpStream.reader.headers["Content-Length"]);
						state = STATE.BODY;
					} else {
						state = STATE.END;
						httpStream.writer.end();
					}
				} else {
				// we found a header
					var i = line.line.indexOf(":");
					var name = line.line.substr(0, i);
					var value = line.line.substr(i+2);
					httpStream.reader.headers[name] = value;
				}
			} // End of in STATE.HEADERS
			else if (state == STATE.BODY) {
				httpStream.writer.write(dataToProcess);
				line.remainder = "";
				bodyLeftToRead = bodyLeftToRead - dataToProcess.length;
				if (bodyLeftToRead < 0) {
					throw new Error("We have written more data than we expected");
				}
				if (bodyLeftToRead === 0) {
					state = STATE.END;
					httpStream.writer.end();

				}
			} else if (state == STATE.END) {
				throw new Error("We have been asked to parse more HTTP data but we are already past the end");
			}

			line = getLine(line.remainder);
		} // End of we have processed all the lines. (end while)
		return line.remainder;
	} // consume
	
	handler(httpStream.reader);
	
	networkStream.reader.on("data", function(data) {
		unconsumedData = consume(unconsumedData + data.toString());
	});
	
	networkStream.reader.on("end", function() {
		log("Received an end of network connection");
	}); // networkStream reader on("end")
	return networkStream.writer;
} // httpparser

module.exports = httpparser;
