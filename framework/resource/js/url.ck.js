/*
 * url 处理模块
 */

C.url = (function(){

    var A = {};

    //解析url
    A.parse = function(url, parseQueryString, slashesDenoteHost) {
        if (url && isObject(url) && url instanceof Url) return url;
        parseQueryString = parseQueryString || true;
        var u = new Url;
        u.parse(url, parseQueryString, slashesDenoteHost);
        return u;
    };

    function Url() {
        this.protocol = null;
        this.slashes = null;
        this.auth = null;
        this.host = null;
        this.port = null;
        this.hostname = null;
        this.hash = null;
        this.search = null;
        this.query = null;
        this.pathname = null;
        this.path = null;
        this.href = null;
    }

// Reference: RFC 3986, RFC 1808, RFC 2396

// define these here so at least they only have to be
// compiled once on the first module load.
    var protocolPattern = /^([a-z0-9.+-]+:)/i,
        portPattern = /:[0-9]*$/,

// RFC 2396: characters reserved for delimiting URLs.
// We actually just auto-escape these.
        delims = ['<', '>', '"', '`', ' ', '\r', '\n', '\t'],

// RFC 2396: characters not allowed for various reasons.
        unwise = ['{', '}', '|', '\\', '^', '`'].concat(delims),

// Allowed by RFCs, but cause of XSS attacks.  Always escape these.
        autoEscape = ['\''].concat(unwise),
// Characters that are never ever allowed in a hostname.
// Note that any invalid chars are also handled, but these
// are the ones that are *expected* to be seen, so we fast-path
// them.
        nonHostChars = ['%', '/', '?', ';', '#'].concat(autoEscape),
        hostEndingChars = ['/', '?', '#'],
        hostnameMaxLen = 255,
        hostnamePartPattern = /^[a-z0-9A-Z_-]{0,63}$/,
        hostnamePartStart = /^([a-z0-9A-Z_-]{0,63})(.*)$/,
// protocols that can allow "unsafe" and "unwise" chars.
        unsafeProtocol = {
            'javascript': true,
            'javascript:': true
        },
// protocols that never have a hostname.
        hostlessProtocol = {
            'javascript': true,
            'javascript:': true
        },
// protocols that always contain a // bit.
        slashedProtocol = {
            'http': true,
            'https': true,
            'ftp': true,
            'gopher': true,
            'file': true,
            'http:': true,
            'https:': true,
            'ftp:': true,
            'gopher:': true,
            'file:': true
        };

    Url.prototype.parse = function(url, parseQueryString, slashesDenoteHost) {
        if (!isString(url)) {
            throw new TypeError("Parameter 'url' must be a string, not " + typeof url);
        }
        var rest = url;

        // trim before proceeding.
        // This is to support parse stuff like "  http://foo.com  \n"
        rest = rest.trim();

        var proto = protocolPattern.exec(rest);
        if (proto) {
            proto = proto[0];
            var lowerProto = proto.toLowerCase();
            this.protocol = lowerProto;
            rest = rest.substr(proto.length);
        }

        // figure out if it's got a host
        // user@server is *always* interpreted as a hostname, and url
        // resolution will treat //foo/bar as host=foo,path=bar because that's
        // how the browser resolves relative URLs.
        if (slashesDenoteHost || proto || rest.match(/^\/\/[^@\/]+@[^@\/]+/)) {
            var slashes = rest.substr(0, 2) === '//';
            if (slashes && !(proto && hostlessProtocol[proto])) {
                rest = rest.substr(2);
                this.slashes = true;
            }
        }

        if (!hostlessProtocol[proto] &&
            (slashes || (proto && !slashedProtocol[proto]))) {

            // there's a hostname.
            // the first instance of /, ?, ;, or # ends the host.
            //
            // If there is an @ in the hostname, then non-host chars *are* allowed
            // to the left of the last @ sign, unless some host-ending character
            // comes *before* the @-sign.
            // URLs are obnoxious.
            //
            // ex:
            // http://a@b@c/ => user:a@b host:c
            // http://a@b?@c => user:a host:c path:/?@c

            // v0.12 TODO(isaacs): This is not quite how Chrome does things.
            // Review our test case against browsers more comprehensively.

            // find the first instance of any hostEndingChars
            var hostEnd = -1;
            for (var i = 0; i < hostEndingChars.length; i++) {
                var hec = rest.indexOf(hostEndingChars[i]);
                if (hec !== -1 && (hostEnd === -1 || hec < hostEnd))
                    hostEnd = hec;
            }

            // at this point, either we have an explicit point where the
            // auth portion cannot go past, or the last @ char is the decider.
            var auth, atSign;
            if (hostEnd === -1) {
                // atSign can be anywhere.
                atSign = rest.lastIndexOf('@');
            } else {
                // atSign must be in auth portion.
                // http://a@b/c@d => host:b auth:a path:/c@d
                atSign = rest.lastIndexOf('@', hostEnd);
            }

            // Now we have a portion which is definitely the auth.
            // Pull that off.
            if (atSign !== -1) {
                auth = rest.slice(0, atSign);
                rest = rest.slice(atSign + 1);
                this.auth = decodeURIComponent(auth);
            }

            // the host is the remaining to the left of the first non-host char
            hostEnd = -1;
            for (var i = 0; i < nonHostChars.length; i++) {
                var hec = rest.indexOf(nonHostChars[i]);
                if (hec !== -1 && (hostEnd === -1 || hec < hostEnd))
                    hostEnd = hec;
            }
            // if we still have not hit it, then the entire thing is a host.
            if (hostEnd === -1)
                hostEnd = rest.length;

            this.host = rest.slice(0, hostEnd);
            rest = rest.slice(hostEnd);

            // pull out port.
            this.parseHost();

            // we've indicated that there is a hostname,
            // so even if it's empty, it has to be present.
            this.hostname = this.hostname || '';

            // if hostname begins with [ and ends with ]
            // assume that it's an IPv6 address.
            var ipv6Hostname = this.hostname[0] === '[' &&
                this.hostname[this.hostname.length - 1] === ']';

            // validate a little.
            if (!ipv6Hostname) {
                var hostparts = this.hostname.split(/\./);
                for (var i = 0, l = hostparts.length; i < l; i++) {
                    var part = hostparts[i];
                    if (!part) continue;
                    if (!part.match(hostnamePartPattern)) {
                        var newpart = '';
                        for (var j = 0, k = part.length; j < k; j++) {
                            if (part.charCodeAt(j) > 127) {
                                // we replace non-ASCII char with a temporary placeholder
                                // we need this to make sure size of hostname is not
                                // broken by replacing non-ASCII by nothing
                                newpart += 'x';
                            } else {
                                newpart += part[j];
                            }
                        }
                        // we test again with ASCII char only
                        if (!newpart.match(hostnamePartPattern)) {
                            var validParts = hostparts.slice(0, i);
                            var notHost = hostparts.slice(i + 1);
                            var bit = part.match(hostnamePartStart);
                            if (bit) {
                                validParts.push(bit[1]);
                                notHost.unshift(bit[2]);
                            }
                            if (notHost.length) {
                                rest = '/' + notHost.join('.') + rest;
                            }
                            this.hostname = validParts.join('.');
                            break;
                        }
                    }
                }
            }

            if (this.hostname.length > hostnameMaxLen) {
                this.hostname = '';
            } else {
                // hostnames are always lower case.
                this.hostname = this.hostname.toLowerCase();
            }

            /*
            if (!ipv6Hostname) {
                // IDNA Support: Returns a puny coded representation of "domain".
                // It only converts the part of the domain name that
                // has non ASCII characters. I.e. it dosent matter if
                // you call it with a domain that already is in ASCII.
                var domainArray = this.hostname.split('.');
                var newOut = [];
                for (var i = 0; i < domainArray.length; ++i) {
                    var s = domainArray[i];
                    newOut.push(s.match(/[^A-Za-z0-9_-]/) ?
                        'xn--' + punycode.encode(s) : s);
                }
                this.hostname = newOut.join('.');
            }
            */

            var p = this.port ? ':' + this.port : '';
            var h = this.hostname || '';
            this.host = h + p;
            this.href += this.host;

            // strip [ and ] from the hostname
            // the host field still retains them, though
            if (ipv6Hostname) {
                this.hostname = this.hostname.substr(1, this.hostname.length - 2);
                if (rest[0] !== '/') {
                    rest = '/' + rest;
                }
            }
        }

        // now rest is set to the post-host stuff.
        // chop off any delim chars.
        if (!unsafeProtocol[lowerProto]) {

            // First, make 100% sure that any "autoEscape" chars get
            // escaped, even if encodeURIComponent doesn't think they
            // need to be.
            for (var i = 0, l = autoEscape.length; i < l; i++) {
                var ae = autoEscape[i];
                var esc = encodeURIComponent(ae);
                if (esc === ae) {
                    esc = escape(ae);
                }
                rest = rest.split(ae).join(esc);
            }
        }


        // chop off from the tail first.
        var hash = rest.indexOf('#');
        if (hash !== -1) {
            // got a fragment string.
            this.hash = rest.substr(hash);
            rest = rest.slice(0, hash);
        }
        var qm = rest.indexOf('?');
        if (qm !== -1) {
            this.search = rest.substr(qm);
            this.query = rest.substr(qm + 1);
            if (parseQueryString) {
                this.query = querystring(this.search);
            }
            rest = rest.slice(0, qm);
        } else if (parseQueryString) {
            // no query string, but parseQueryString still requested
            this.search = '';
            this.query = {};
        }
        if (rest) this.pathname = rest;
        if (slashedProtocol[lowerProto] &&
            this.hostname && !this.pathname) {
            this.pathname = '/';
        }

        //to support http.request
        if (this.pathname || this.search) {
            var p = this.pathname || '';
            var s = this.search || '';
            this.path = p + s;
        }

        // finally, reconstruct the href based on what has been validated.
        this.href = this.format();
        return this;
    };



    Url.prototype.format = function() {
        var auth = this.auth || '';
        if (auth) {
            auth = encodeURIComponent(auth);
            auth = auth.replace(/%3A/i, ':');
            auth += '@';
        }

        var protocol = this.protocol || '',
            pathname = this.pathname || '',
            hash = this.hash || '',
            host = false,
            query = '';

        if (this.host) {
            host = auth + this.host;
        } else if (this.hostname) {
            host = auth + (this.hostname.indexOf(':') === -1 ?
                this.hostname :
                '[' + this.hostname + ']');
            if (this.port) {
                host += ':' + this.port;
            }
        }

        /*
        if (this.query &&
            isObject(this.query) &&
            Object.keys(this.query).length) {
            query = querystring.stringify(this.query);
        }
*/
        var search = this.search || (query && ('?' + query)) || '';

        if (protocol && protocol.substr(-1) !== ':') protocol += ':';

        // only the slashedProtocols get the //.  Not mailto:, xmpp:, etc.
        // unless they had them to begin with.
        if (this.slashes ||
            (!protocol || slashedProtocol[protocol]) && host !== false) {
            host = '//' + (host || '');
            if (pathname && pathname.charAt(0) !== '/') pathname = '/' + pathname;
        } else if (!host) {
            host = '';
        }

        if (hash && hash.charAt(0) !== '#') hash = '#' + hash;
        if (search && search.charAt(0) !== '?') search = '?' + search;

        pathname = pathname.replace(/[?#]/g, function(match) {
            return encodeURIComponent(match);
        });
        search = search.replace('#', '%23');

        return protocol + host + pathname + search + hash;
    };



    Url.prototype.parseHost = function() {
        var host = this.host;
        var port = portPattern.exec(host);
        if (port) {
            port = port[0];
            if (port !== ':') {
                this.port = port.substr(1);
            }
            host = host.substr(0, host.length - port.length);
        }
        if (host) this.hostname = host;
    };

    function isString(arg) {
        return typeof arg === "string";
    }

    function isObject(arg) {
        return typeof arg === 'object' && arg !== null;
    }

    function isNull(arg) {
        return arg === null;
    }
    function isNullOrUndefined(arg) {
        return  arg == null;
    }


    //解析请求参数
    var querystring = A.querystring =function(search,cx,sp){
        cx = cx || '?';
        sp = sp || '&';
        var theRequest = []
            , leg = 0;
        if (search.indexOf(cx) != -1) {
            var str = search.substr(1);
            strs = str.split(sp);
            for(var i = 0; i < strs.length; i ++) {
                var key = strs[i].split("=")[0]
                    , value = strs[i].split("=")[1];
                if(value){
                    leg++; //有参数
                    theRequest[key]=unescape(value);
                }
            }
        }
        return leg>0?theRequest:(search.replace(cx,''));
    }




    return A;

})();
