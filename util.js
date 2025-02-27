var cookie = require('cookie')
var yargs = require('yargs')
var URL = require('url')
var querystring = require('querystring')

/**
 * given this: [ 'msg1=value1', 'msg2=value2' ]
 * output this: 'msg1=value1&msg2=value2'
 * @param dataArguments
 */
var joinDataArguments = function (dataArguments) {
  var data = ''
  dataArguments.forEach(function (argument, i) {
    if (i === 0) {
      data += argument
    } else {
      data += '&' + argument
    }
  })
  return data
}

var parseCurlCommand = function (curlCommand) {
  var newlineFound = /\r|\n/.exec(curlCommand)
  if (newlineFound) {
    // remove newlines
    curlCommand = curlCommand.replace(/\\\r|\\\n/g, '')
  }
  // yargs parses -XPOST as separate arguments. just prescreen for it.
  curlCommand = curlCommand.replace(/ -XPOST/, ' -X POST')
  curlCommand = curlCommand.replace(/ -XGET/, ' -X GET')
  curlCommand = curlCommand.replace(/ -XPUT/, ' -X PUT')
  curlCommand = curlCommand.replace(/ -XPATCH/, ' -X PATCH')
  curlCommand = curlCommand.replace(/ -XDELETE/, ' -X DELETE')
  curlCommand = curlCommand.trim()
  var yargObject = yargs(curlCommand)
  var parsedArguments = yargObject.argv
  var cookieString
  var cookies
  var url = parsedArguments._[1]
  // if url argument wasn't where we expected it, try to find it in the other arguments
  if (!url) {
    for (var argName in parsedArguments) {
      if (typeof parsedArguments[argName] === 'string') {
        if (parsedArguments[argName].indexOf('http') === 0 || parsedArguments[argName].indexOf('www.') === 0) {
          url = parsedArguments[argName]
        }
      }
    }
  }

  var headers

  var parseHeaders = function (headerFieldName) {
    if (parsedArguments[headerFieldName]) {
      if (!headers) {
        headers = {}
      }
      if (!Array.isArray(parsedArguments[headerFieldName])) {
        parsedArguments[headerFieldName] = [parsedArguments[headerFieldName]]
      }
      parsedArguments[headerFieldName].forEach(function (header) {
        if (header.indexOf('Cookie') !== -1) {
          // stupid javascript tricks: closure
          cookieString = header
        } else {
          var colonIndex = header.indexOf(':')
          var headerName = header.substring(0, colonIndex)
          var headerValue = header.substring(colonIndex + 1).trim()
          headers[headerName] = headerValue
        }
      })
    }
  }

  parseHeaders('H')
  parseHeaders('header')
  if (parsedArguments.A) {
    if (!headers) {
      headers = []
    }
    headers['User-Agent'] = parsedArguments.A
  } else if (parsedArguments['user-agent']) {
    if (!headers) {
      headers = []
    }
    headers['User-Agent'] = parsedArguments['user-agent']
  }

  if (parsedArguments.b) {
    cookieString = parsedArguments.b
  }
  if (parsedArguments.cookie) {
    cookieString = parsedArguments.cookie
  }
  var multipartUploads
  if (parsedArguments.F) {
    multipartUploads = {}
    if (!Array.isArray(parsedArguments.F)) {
      parsedArguments.F = [parsedArguments.F]
    }
    parsedArguments.F.forEach(function (multipartArgument) {
      // input looks like key=value. value could be json or a file path prepended with an @
      var splitArguments = multipartArgument.split('=', 2)
      var key = splitArguments[0]
      var value = splitArguments[1]
      multipartUploads[key] = value
    })
  }
  if (cookieString) {
    var cookieParseOptions = {
      decode: function (s) { return s }
    }
    // separate out cookie headers into separate data structure
    // note: cookie is case insensitive
    cookies = cookie.parse(cookieString.replace(/^Cookie: /gi, ''), cookieParseOptions)
  }
  var method
  if (parsedArguments.X === 'POST') {
    method = 'post'
  } else if (parsedArguments.X === 'PUT' ||
    parsedArguments['T']) {
    method = 'put'
  } else if (parsedArguments.X === 'PATCH') {
    method = 'patch'
  } else if (parsedArguments.X === 'DELETE') {
    method = 'delete'
  } else if (parsedArguments.X === 'OPTIONS') {
    method = 'options'
  } else if ((parsedArguments['d'] ||
    parsedArguments['data'] ||
    parsedArguments['data-binary'] ||
    parsedArguments['F'] ||
    parsedArguments['form']) && !((parsedArguments['G'] || parsedArguments['get']))) {
    method = 'post'
  } else if (parsedArguments['I'] ||
    parsedArguments['head']) {
    method = 'head'
  } else {
    method = 'get'
  }

  var compressed = !!parsedArguments.compressed
  var urlObject = URL.parse(url) // eslint-disable-line

  // if GET request with data, convert data to query string
  // NB: the -G flag does not change the http verb. It just moves the data into the url.
  if (parsedArguments['G'] || parsedArguments['get']) {
    urlObject.query = urlObject.query ? urlObject.query : ''
    var option = 'd' in parsedArguments ? 'd' : 'data' in parsedArguments ? 'data' : null
    if (option) {
      var urlQueryString = ''

      if (url.indexOf('?') < 0) {
        url += '?'
      } else {
        urlQueryString += '&'
      }

      if (typeof (parsedArguments[option]) === 'object') {
        urlQueryString += parsedArguments[option].join('&')
      } else {
        urlQueryString += parsedArguments[option]
      }
      urlObject.query += urlQueryString
      url += urlQueryString
      delete parsedArguments[option]
    }
  }
  var query = querystring.parse(urlObject.query, null, null, { maxKeys: 10000 })

  urlObject.search = null // Clean out the search/query portion.
  var request = {
    url: url,
    urlWithoutQuery: URL.format(urlObject)
  }
  if (compressed) {
    request['compressed'] = true
  }

  if (Object.keys(query).length > 0) {
    request.query = query
  }
  if (headers) {
    request.headers = headers
  }
  request['method'] = method

  if (cookies) {
    request.cookies = cookies
    request.cookieString = cookieString.replace('Cookie: ', '')
  }
  if (multipartUploads) {
    request.multipartUploads = multipartUploads
  }
  if (parsedArguments.data) {
    request.data = parsedArguments.data
  } else if (parsedArguments['data-binary']) {
    request.data = parsedArguments['data-binary']
    request.isDataBinary = true
  } else if (parsedArguments['d']) {
    request.data = parsedArguments['d']
  }

  if (parsedArguments['u']) {
    request.auth = parsedArguments['u']
  }
  if (parsedArguments['user']) {
    request.auth = parsedArguments['user']
  }
  if (Array.isArray(request.data)) {
    request.dataArray = request.data
    request.data = joinDataArguments(request.data)
  }

  if (parsedArguments['k'] || parsedArguments['insecure']) {
    request.insecure = true
  }
  return request
}

var serializeCookies = function (cookieDict) {
  var cookieString = ''
  var i = 0
  var cookieCount = Object.keys(cookieDict).length
  for (var cookieName in cookieDict) {
    var cookieValue = cookieDict[cookieName]
    cookieString += cookieName + '=' + cookieValue
    if (i < cookieCount - 1) {
      cookieString += '; '
    }
    i++
  }
  return cookieString
}

module.exports = {
  parseCurlCommand: parseCurlCommand,
  serializeCookies: serializeCookies
}
