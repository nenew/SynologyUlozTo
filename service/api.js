'option strict';

module.exports = {getDownloadLink:getDownloadLink, getSuggestions:getSuggestions, getSearchResults:getSearchResults};

var request = require("request");

// download link

var mainurl;
var captchaurl = "https://ulozto.cz/reloadXapca.php?rnd=";
var form = {};
var keepCookie = "";
var onSuccess;
var processCaptcha;

var currentRequest = "";
var lastRequest = "";
var lastResponse = "";

function getDownloadLink(lnk, captcha, handler)
{
  if ( lnk == lastRequest )
  {
    handler(lastResponse);
    return;
  }

  keepCookie = ""; // TODO!!!
  currentRequest = lnk;
  onSuccess = handler;
  processCaptcha = captcha;
  mainurl = "https://ulozto.cz" + lnk;

  myRequest(mainurl, function(body) {
    body = body.split("\r").join("").split("\n").join("#");
            
    keepCookie  = body.match("(ULOSESSID=.*?);")[1];
    keepCookie += "; "+body.match("(uloztoid=.*?);")[1];
    //keepCookie += "; maturity=adult";
            
    var newLocation = body.match("#Location: (.*?)#");
    mainurl = newLocation[1];
    doMainRequest(doCaptcha);
  });
}

function mySpawn(command, args, handler)
{
  var cmdline = command;
  for (var i = 0; i < args.length; i++)
  {
    if ( args[i].indexOf(' ') != -1 || args[i].indexOf('?') != -1 || args[i].indexOf('&') != -1 )
      cmdline += " \"" + args[i] + "\"";
    else
      cmdline += " " + args[i];
  }

  const spawn = require('child_process').spawn;
  const proc = spawn('curl', args);

  var response = "";

  proc.stdout.on('data', function(data) {
    response += data;
  });

  proc.stderr.on('data', function (data) {
    console.log('stderr: ' + data);
  });

  proc.on('close', function(code) {
    handler(response);
  });

  return proc;
}

function myDownload(url, filename)
{
  request({url:url, encoding:"binary"}, function(error, response, body) {
    var fs = require('fs');
    fs.writeFile(filename, body, "binary");
  });
}

function myRequest(url, handler, data)
{
  var args = [url, "-s", "-D", "-"];
  if ( keepCookie != "" )
  {
    args.push("-H");
    args.push("Cookie: "+keepCookie);
  }
    
  if ( typeof(data) != "undefined" )
  {
    args.push("-H");
    args.push("X-Requested-With: XMLHttpRequest");

    var q = "";
    for ( var i in form )
    {
      if ( q != "" ) q += "&"
      q += i + "="+ encodeURIComponent(form[i]);
    }
    args.push("--data");
    args.push(q);
  }

  mySpawn('curl', args, handler);
}

function doMainRequest(onFinish)
{
  var getvar = function (html, key)
  {
    var regex = "name=\""+key+"\".*?value=\"(.*?)\"";
    var result = html.match(regex);
    if (result && result.length > 1)
      return result[1] + "";
    else
      console.log("ERROR: Cannot find form field '"+key+"'!");
    return "?";
  }

  myRequest(mainurl, function(body) {
    body = body.split("\r").join("").split("\n").join("");
            
    var formId = "frm-download-freeDownloadTab-freeDownloadForm";
    var formhtmlMatch = body.match("id=\""+formId+"\"(.*)</form>");
    if ( !formhtmlMatch || formhtmlMatch.length != 2 )
    {
      console.log("ERROR: FORM DATA not found: <<<"+body+">>>");
      return;
    }

    var formhtml = formhtmlMatch[1];

    form._token_ = getvar(formhtml, "_token_");
    form.ts = getvar(formhtml, "ts");
    form.cid = getvar(formhtml, "cid");
    form.adi = getvar(formhtml, "adi"); // ="f" for reloaded captcha
    form.sign_a = getvar(formhtml, "sign_a");
    form.sign = getvar(formhtml, "sign");
    form.captcha_type = "xapca";
    form._do = "download-freeDownloadTab-freeDownloadForm-submit";            

    onFinish();
  })
}

function doCaptcha()
{
  myRequest(captchaurl + (new Date).getTime(), function(data)
  {
    data = data.substr(data.indexOf("\r\n\r\n")+4);
    var json = JSON.parse(data);
    var image = json.image;
    form.timestamp = json.timestamp;
    form.hash = json.hash;
    form.salt = json.salt;
    processCaptcha({image:"http:"+json.image, sound:"http:"+json.sound}, tryCaptcha);
  })
}

function tryCaptcha(code)
{
  form.captcha_value = code;
  requestDownload(processResponse);
}

function requestDownload(onResponse)
{
  myRequest(mainurl, function(data)
  {
    data = data.substr(data.indexOf("\r\n\r\n")+4);
    onResponse(data);
  }, form);
}

function processResponse(data)
{
  var json = JSON.parse(data);

  if ( json.status == "error" )
  {
    console.log(json.errors);

    form.ts = json.new_form_values.ts;
    form.cid = json.new_form_values.cid;
    form.sign = json.new_form_values.sign;
    form._token_ = json.new_form_values._token_;

    form.hash = json.new_form_values.xapca_hash;
    form.salt = json.new_form_values.xapca_salt;
    form.timestamp = json.new_form_values.xapca_timestamp;

    processCaptcha({image:"http:"+json.new_captcha_data.image, sound:"http:"+json.new_captcha_data.sound}, tryCaptcha);
  }

  if ( json.status == "ok" )
  {
    lastRequest = currentRequest;
    lastResponse = json.url;
    onSuccess(json.url);
  }
}

// suggestions
function getSuggestions(term, onResponse)
{
  var suggestUrl = "https://ulozto.cz/searchSuggest.php?term=" + escape(term);

  request(suggestUrl, function(error, response, body) {
    onResponse(body);
  });
}

// search result
var decoderClass = require('./blowfish.js').blowfish;

function getSearchResults(term, onResponse)
{
  var searchUrl = "https://ulozto.cz/hledej?q=" + escape(term);

  var trim = function (str)
  {
    while ( str.length > 1 && str.charCodeAt(str.length-1) == 0 )
      str = str.substr(0, str.length-1);
    return new Buffer(str, "binary").toString("utf8");
  }

  var safematch = function(item, regexp)
  {
    var m = item.match(regexp);
    if ( m && m.length == 2 )
      return m[1];
    return "";
  }
    
  var decode = function(data, key)
  {
  	var decoder = new decoderClass(key);
    var result = [];
    var first = true;
      
    for (var i in data)
    {
      var item = trim(decoder.decrypt(data[i])).split("\n").join("");
      item = item.split("\t").join("");
     
      // last item is corrupted, first is always mtbr.abi
      if ( item.indexOf("title") == -1 || first )
      {
        first = false;
        continue;
      }

      var url = safematch(item, "class=\"name\".*?href=\"(.*?)\"");
      var img = "<img src=\"https:" + safematch(item, "class=\"img.*?src=\"(.*?)\"") + "\">";
      var rating = safematch(item, "<abbr title=\"Hodno.*?\">(.*?)</abbr>");
      var name = safematch(item, "title=\"(.*?)\"");
      var size = safematch(item, "<span>Velikost</span>(.*?)</li>");
      var time = safematch(item, "<span>.?as</span>(.*?)</li>");
      var type = safematch(item, "<span class=\"type\">(.*?)</span>");
        
      // skip locked files
      if ( img.indexOf("/lock.") != -1 )
        continue;
        
      result.push({url:url, img:img, rating:rating, name:name, size:size, time:time, type:type, data:item});
    }
    return result;
  }
    
  request({
      url: searchUrl,
      method: "GET",
      headers: {"X-Requested-With": "XMLHttpRequest"}
    }, function(error, response, body)
    {
      body = body.split("\n").join("").split("\\").join("");
      var dataraw = body.match("var kn = (\\{.*?\\})");
      if ( !dataraw || dataraw.length != 1)
        console.log("Failed to parse json response (contents)");
          
      var data = JSON.parse(dataraw[1]);
      var keyraw = body.match("kn\\[\"(.*?)\"\\]");
      if ( !keyraw || keyraw.length != 1)
        console.log("Failed to parse json response (key)");
          
      var key = keyraw[1];
      var result = decode(data, data[key]);
          
      onResponse(result);
  });
}
