// <nowiki>
( function () {
    var UNBLOCK_REQ_COLOR = "rgb(235, 244, 255)";
    var SIGNATURE = "~~" + "~~";
    var DECLINE_REASON_HERE = "{" + "{subst:Decline reason here}}"; // broken up to prevent processing
    var ADVERT = " ([[User:Enterprisey/unblock-review|unblock-review]])";

    // Making this a function for unit test reasons.
    function getInitialText(wikitext, appealReason) {
        // https://stackoverflow.com/a/6969486/3480193
        function escapeRegExp(string) {
            return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
        }

        let regEx = new RegExp(escapeRegExp(appealReason), 'g');
        let matches = wikitext.matchAll(regEx);
        matches = [...matches];
        if( matches.length === 0 ) {
            throw new Error( "Searching for target text failed!" );
        }
        for ( let match of matches ) {
            var textIdx = match.index;
            var startIdx = textIdx;

            // check for {{tlx|unblock. if found, this isn't what we want, skip.
            let startOfSplice = startIdx - 50 < 0 ? 0 : startIdx - 50;
            var chunkFiftyCharactersWide = wikitext.substring(startOfSplice, startIdx);
            if ( /\{\{\s*tlx\s*\|\s*unblock/i.test(chunkFiftyCharactersWide) ) {
                continue;
            }

            let i = 0;
            while( wikitext[startIdx] != "{" && i < 50 ) {
                startIdx--;
                i++;
            }
            if( i == 50 ) {
                continue;
            }

            startIdx--; // templates start with two opening curly braces

            var initialText = wikitext.substring( startIdx, textIdx );
            return initialText;
        }

        throw new Error( "Searching backwards failed!" );
    }

    if( mw.config.get( "wgNamespaceNumber" ) === 3 ) {
        /**
         * Is there a signature (four tildes) present in the given text,
         * outside of a nowiki element?
         */
        function hasSig( text ) {
            // no literal signature?
            if( text.indexOf( SIGNATURE ) < 0 ) return false;

            // if there's a literal signature and no nowiki elements,
            // there must be a real signature
            if( text.indexOf( "<nowiki>" ) < 0 ) return true;

            // Save all nowiki spans
            var nowikiSpanStarts = []; // list of ignored span beginnings
            var nowikiSpanLengths = []; // list of ignored span lengths
            var NOWIKI_RE = /<nowiki>.*?<\/nowiki>/g;
            var spanMatch;
            do {
                spanMatch = NOWIKI_RE.exec( text );
                if( spanMatch ) {
                    nowikiSpanStarts.push( spanMatch.index );
                    nowikiSpanLengths.push( spanMatch[0].length );
                }
            } while( spanMatch );

            // So that we don't check every ignore span every time
            var nowikiSpanStartIdx = 0;

            var SIG_RE = new RegExp( SIGNATURE, "g" );
            var sigMatch;

            matchLoop:
            do {
                sigMatch = SIG_RE.exec( text );
                if( sigMatch ) {
                    // Check that we're not inside a nowiki
                    for( var nwIdx = nowikiSpanStartIdx; nwIdx <
                        nowikiSpanStarts.length; nwIdx++ ) {
                        if( sigMatch.index > nowikiSpanStarts[nwIdx] ) {
                            if ( sigMatch.index + sigMatch[0].length <=
                                nowikiSpanStarts[nwIdx] + nowikiSpanLengths[nwIdx] ) {

                                // Invalid sig
                                continue matchLoop;
                            } else {

                                // We'll never encounter this span again, since
                                // headers only get later and later in the wikitext
                                nowikiSpanStartIdx = nwIdx;
                            }
                        }
                    }

                    // We aren't inside a nowiki
                    return true;
                }
            } while( sigMatch );
            return false;
        }

        /**
         * Given the div of an unblock request, set up the UI and event
         * listeners.
         */
        function setUpUi( unblockDiv ) {
            var container = document.createElement( "table" );
            container.className = "unblock-review";
            var hrEl = unblockDiv.querySelector( "hr" );
            container.innerHTML = "<tr><td class='reason-container' rowspan='2'>" +
                "<textarea class='unblock-review-reason mw-ui-input'" +
                " placeholder='Reason for accepting/declining here'>" + DECLINE_REASON_HERE + "</textarea></td>" +
                "<td><button class='unblock-review-accept mw-ui-button mw-ui-progressive'>Accept</button></td></tr>" +
                "<tr><td><button class='unblock-review-decline mw-ui-button mw-ui-destructive'>Decline</button></td></tr>";
            unblockDiv.insertBefore( container, hrEl.previousElementSibling );
            var reasonArea = container.querySelector( "textarea" );
            $( container ).find( "button" ).click( function () {
                var action = $( this ).text().toLowerCase();
                var appealReason = hrEl.nextElementSibling.nextElementSibling.childNodes[0].textContent;
                $.getJSON(
                    mw.util.wikiScript( "api" ),
                    {
                        format: "json",
                        action: "query",
                        prop: "revisions",
                        rvprop: "content",
                        rvlimit: 1,
                        titles: mw.config.get( "wgPageName" )
                    }
                ).done( function ( data ) {
                    // Extract wikitext from API response
                    var pageId = Object.keys(data.query.pages)[0];
                    wikitext = data.query.pages[pageId].revisions[0]["*"];

                    var initialText = getInitialText(wikitext, appealReason);

                    // Build accept/decline reason
                    var reason = reasonArea.value;
                    if( !reason.trim() ) {
                        reason = DECLINE_REASON_HERE + " " + SIGNATURE;
                    } else if( !hasSig( reason ) ) {
                        reason = reason + " " + SIGNATURE;
                    }
                    wikitext = wikitext.replace( initialText + appealReason, "{" +
                        "{unblock reviewed|" + action + "=" + reason + "|1=" + appealReason );

                    var summary = ( action === "accept" ? "Accepting" : "Declining" ) +
                        " unblock request" + ADVERT;

                    ( new mw.Api() ).postWithToken( "csrf", {
                        action: "edit",
                        title: mw.config.get( "wgPageName" ),
                        summary: summary,
                        text: wikitext
                    } ).done ( function ( data ) {
                        if ( data && data.edit && data.edit.result && data.edit.result == "Success" ) {
                            window.location.reload( true );
                        } else {
                            console.log( data );
                        }
                    } );
                } );
            } );
        }

        $.when( $.ready, mw.loader.using( [ "mediawiki.api", "mediawiki.util" ] ) ).then( function () {
            mw.util.addCSS(
                ".unblock-review td { padding: 0 }" +
                "td.reason-container { padding-right: 1em; width: 30em }" +
                ".unblock-review-reason { height: 5em }" );
            importStylesheet( "User:Enterprisey/mw-ui-button.css" );
            importStylesheet( "User:Enterprisey/mw-ui-input.css" );
            var userBlockBoxes = document.querySelectorAll( "div.user-block" );
            for( var i = 0, n = userBlockBoxes.length; i < n; i++ ) {
                if( userBlockBoxes[i].style["background-color"] !== UNBLOCK_REQ_COLOR ) {
                    continue;
                }
                
                // We now have a pending unblock request - add UI
                setUpUi( userBlockBoxes[i] );
            }
        } );
    }
} )();
// </nowiki>
