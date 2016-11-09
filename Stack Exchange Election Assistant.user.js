// ==UserScript==
// @name        Stack Exchange, Election Assistant
// @description Lists candidates in sorted order. Provides: quickjump, bookmarks, state tracking, and much more.
// @match       *://*.askubuntu.com/election*
// @match       *://*.mathoverflow.net/election*
// @match       *://*.serverfault.com/election*
// @match       *://*.stackapps.com/election*
// @match       *://*.stackexchange.com/election*
// @match       *://*.stackoverflow.com/election*
// @match       *://*.superuser.com/election*
// @match       *://elections.stackexchange.com/*
// @require     http://ajax.googleapis.com/ajax/libs/jquery/2.1.0/jquery.min.js
// @require     https://gist.github.com/raw/2625891/waitForKeyElements.js
// @grant       GM_addStyle
// @grant       GM_setValue
// @grant       GM_getValue
// @noframes
// @version     1.3
// @history     1.3 Cosmetic fixes; modern multiline strings, glitch in saved data when # of candidates change.
// @history     1.2 Improve detection of election pages that don't yet have any candidates.
// @history     1.1 Improve detection of overview pages.
// @history     1.0 Initial release.
// @updateURL   https://github.com/BrockA/SE-Election-Assistant/raw/master/Stack Exchange Election Assistant.user.js
// @downloadURL https://github.com/BrockA/SE-Election-Assistant/raw/master/Stack Exchange Election Assistant.user.js
// ==/UserScript==

/*---------------------------------------------------
Common global stuff:
*/
var urlParams       = getUrlParameters ();
var gblUserId       = urlParams["id"];
var gblUserName     = urlParams["uname"];
var currentTab      = $(".youarehere").text (). trim()  ||  location.search.replace (/\?tab=/, "");
var onPrimaryPg     = currentTab === "primary";
var onElectionPg    = currentTab === "election";
var siteNameKey     = (location.hostname + location.pathname).replace (/\W/g, "_");

var onSEMC_pages    = location.hostname === "elections.stackexchange.com";
if (onSEMC_pages) {
    if ( ! gblUserId  ||  ! gblUserName)
        return;

    SEMC_main ();
}
else {
    if (/\/election[\/0]*$/.test (location.pathname)  &&  $("#content > #mainbar-full > table.elections").length) {
        /*--- We are an election home/summary/overview page, not an actual election.
            Note that an election will have this path if it is the only election for that site, so far.
        */
        return;
    }

    /*-- Direct linking has no anchors on the election page. So, if on that page and
        a user id was passed in, scroll to the appropriate post.
    */
    var postId  = urlParams["pid"];;
    if (postId  &&  onElectionPg) {
        var userPost    = $('#' + postId + ', tr[data-candidate-id=' + postId + ']');
        if (userPost.length) {
            chaseNodeForX_seconds (userPost, 4);
        }
    }

    //-- Works on nomination and primary pages:
    var candidates  = $("#mainbar ").find ("[id^='post-']");
    //-- Needed on election pages:
    if (candidates.length === 0 ) {
        candidates  = $("#mainbar ").find (".candidate-row");
    }
    if (candidates.length === 0 ) {
        var candidateCnt  = $("#sidebar .label-key:contains('oderator candidates')").next (".label-value").text (). trim ();
        if ( ! /^\d+$/.test (candidateCnt) ) {
            $('<div>Oops!  This is not an election page or the format has changed.</div>')
                .prependTo (".container")
                .css ( {
                    background:     "red",
                    "font-size":    "2em",
                    padding:        "1em",
                    "text-align":   "center"
                } )
            ;
            return;
        }
    }
    //--- SE's page does overwrites and dynamic sizing. Allow for that.
    window.addEventListener ("load", officialElectionPageMain);
}


/*---------------------------------------------------
The "Main" main...
*/
function officialElectionPageMain () {
    window.candVitals   = candidates.map ( function () {
        var candEntry   = $(this);
        var idLink      = candEntry.find (".user-details > a");
        var userId      = idLink.attr ("href").replace (/^.+?(\d+).*$/, "$1");
        var userName    = idLink.text ();
        var electScore  = candEntry.find (".candidate-score-breakdown > span").text ().trim ();
            electScore  = parseInt (electScore.replace (/^.+core (\d+).*$/i, "$1"), 10);
        var reputation  = candEntry.find (".candidate-score-breakdown > ul > li").eq (0).text ().trim ();
            reputation  = reputation.replace (/^.+?eputation\s+(.+)$/, "$1");
        var memberFor   = candEntry.find (".user-info > .user-details").clone ();
            memberFor   = memberFor.find ("a").remove ().end ().text ().trim ();
            memberFor   = memberFor.replace (/member for /i, "");
        var userPic     = candEntry.find (".gravatar-wrapper-32 > img").attr ("src");
        var postId      = this.id  ||  this.dataset.candidateId;
        var dwnVoted    = 0;  //-- Votes not on page yet; will be ajaxed in by page.
        var hideUser    = 0;

        return ( [
            [   hideUser,               //--  0 -- Will be altered by stored settings and user.
                userName,               //--  1
                electScore,             //--  2
                postId,                 //--  3
                userId,                 //--  4
                reputation,             //--  5
                memberFor,              //--  6
                userPic,                //--  7
                0, // rejected          //--  8 -- Will be altered by stored settings and user.
                dwnVoted,               //--  9 -- Will always be 0 at this moment.  Use wfke to update these on AJAX-in.
                1, // isOnPage          //-- 10 -- Not every page has every user.
                0  // liked             //-- 11 -- Will be altered by stored settings and user.
            ]
        ] );
    } ).get ();

    //--- Cross update candVitals with any saved data.
    var savedVitals  = JSON.parse (GM_getValue (siteNameKey, "[0]") );
    console.log ("savedVitals: ", savedVitals);
    if (savedVitals  &&  savedVitals[0].length === 4) {
        /*---
            savedVitals is keyed off userId and has 4 columns:
                hideUser    //--  0
                rejected    //--  1
                liked       //--  2
                dwnVoted    //--  3

            Loop through candVitals and update the following fields if found in saved data:
                hideUser, rejected, liked

            If not on the primary page, also update dwnVoted.
        */
        for (var J = candVitals.length - 1;  J >= 0;  --J) {
            var candEntry   = candVitals[J];
            var userId      = candEntry[4];
            var svdEntry    = savedVitals[userId];
            if (svdEntry) {
                candEntry[0]    = svdEntry[0];  //-- hideUser
                candEntry[8]    = svdEntry[1];  //-- rejected
                candEntry[11]   = svdEntry[2];  //-- liked
                if ( ! onPrimaryPg) {
                    candEntry[9] = svdEntry[3]; //-- dwnVoted
                }
                //delete savedVitals[userId];
            }
        }

        /*--- Now add any rows that were in savedVitals and not in candVitals to candVitals.
            Set isOnPage to 0.
            We do this so that user's filter data, from prev pages, is not lost.
        */
        for (var userId in savedVitals) {
            if (savedVitals.hasOwnProperty (userId) ) {
                var svdEntry    = savedVitals[userId];
                var newCV_Entry = [
                    svdEntry[0],    //-- hideUser,
                    "",             //-- userName,
                    0,              //-- electScore,
                    "",             //-- postId,
                    userId,         //-- userId,
                    "",             //-- reputation,
                    "",             //-- memberFor,
                    "",             //-- userPic,
                    svdEntry[1],    //-- rejected,
                    svdEntry[3],    //-- dwnVoted,
                    0,              //-- isOnPage,
                    svdEntry[2],    //-- liked
                ];
                candVitals.concat ( [newCV_Entry] );
            }
        }
    }

    candVitals      = candVitals.sort (sortByName);
    candVitals      = candVitals.sort (sortByScore);

    $("body").append ( `
        <div style="display:none; position:fixed; width: 9rem;" id="gmEaElectionOverlay">
            <h3>Candidate Filter and Jump table <span id="gmEaUsers"></span></h3><button>&#x23EB;</button>
            <div class="gmEaTabs"></div>
            <div id="gmEaSlideToggleWrap">
                <div id="gmEaScrollableWrap"><table></table></div>
                <div id="gmEaMetaControls">
                    <div class="gmEaResetTableBtns">
                        <button id="gmEaHideCandidates">Hide all</button>
                        <button id="gmEaHideComments">Hide comments</button>
                    </div>
                    <div class="gmEaSortTableBtns">
                        <label><input type="radio" name="gmEaTblSortType" value="score" checked>Sort Score</label><br>
                        <label><input type="radio" name="gmEaTblSortType" value="name">Sort Name</label>
                        <!-- Switch on only for primary page/tab. Must reduce font size and/or bump card size
                        <label><input type="radio" name="gmEaTblSortType" value="vote">Sort Votes</label>
                        -->
                    </div>
                    <button id="gmEaSave">Save</button>
                </div>
            </div>
        </div>
    ` );

    var baseUrl     = location.protocol + "//" + location.host + location.pathname;
    var tabBar      = $("#gmEaElectionOverlay > .gmEaTabs");

    $.each (["nomination", "primary", "election"], function () {
        var newNode = $('<a href="' + baseUrl + '?tab=' + this + '">' + this + '</a>').appendTo (tabBar);
        if (this == currentTab)
            newNode.addClass ("gmEaSelected");
    } );

    var siteParam       = location.hostname.replace (/\.(com|net)$/, "");

    window.jmpTable     = $("#gmEaScrollableWrap > table");
    $.each (candVitals, function () {
        var hideUser    = this[0],
            userName    = this[1],
            electScore  = this[2],
            postId      = this[3],
            userId      = this[4],
            reputation  = this[5],
            memberFor   = this[6],
            userPic     = this[7],
            rejected    = this[8],
            dwnVoted    = this[9],
            isOnPage    = this[10],
            liked       = this[11];

        if (isOnPage) {
            if (onElectionPg) {
                var bkmkUrl     = cloneSimpleObject (location);
                bkmkUrl.hash    = "";
                bkmkUrl.search  = 'pid=' + postId;
                bkmkUrl         = hrefObjToUrl (bkmkUrl);
            }
            else {
                var bkmkUrl     = rehashURL (location, postId);
            }
            var newNode = $(
                  '<tr data-user-id="' + userId + '">'
                +   '<td class="gmEaClickable" title="Jump to ' + userName + '\'s entry."><img src="' + userPic + '"></td>\n'
                +   '<td class="gmEaClickable gmEaStopOverflow" title="Jump to ' + userName + '\'s entry.">' + userName + '<br>\n' + memberFor + '</td>\n'
                +   '<td class="gmEaClickable" title="Jump to ' + userName + '\'s entry.">' + electScore + '<br>\n' + reputation + '</td>\n'
                +   '<td><button class="gmEaHideBtn">hide</button>\n'
                +   '    <button class="gmEaRejectBtn">reject</button>\n'
                +   '    <button class="gmEaLikeBtn">like</button>\n'
                +   '    <a href="' + bkmkUrl + '">bkmrk</a>\n'
                +   '    <a href="http://elections.stackexchange.com/?id=' + userId + '&uname=' + encodeURIComponent(userName) + '#' + siteParam + '">semcs</a>\n'
                +   '</td>\n'
                + '</tr>'
            )
            .appendTo (jmpTable);

            //--- Update liked, hidden, & rejected displays as needed.
            if (liked) {
                var btnjNode    = newNode.find (".gmEaLikeBtn");
                var userPost    = upDateCandidateStatus (
                    true,                       //-- bApply
                    btnjNode,                   //-- btnjNode
                    "clear",                    //-- newBtnText
                    newNode,                    //-- jmpTblRow
                    "gmEaCandidateLiked",       //-- jmpTblClass
                    11                          //-- cvTblColIdx
                );
                userPost.css ("background", "#ffffb3");
            }
            if (rejected) {
                var btnjNode    = newNode.find (".gmEaRejectBtn");
                var userPost    = upDateCandidateStatus (
                    true,                       //-- bApply
                    btnjNode,                   //-- btnjNode
                    "clear",                    //-- newBtnText
                    newNode,                    //-- jmpTblRow
                    "gmEaCandidateRejected",    //-- jmpTblClass
                    8                           //-- cvTblColIdx
                );
                userPost.css ("background", "darkred");
            }
            if (hideUser || rejected) {
                var btnjNode    = newNode.find (".gmEaHideBtn");
                var userPost    = upDateCandidateStatus (
                    true,                       //-- bApply
                    btnjNode,                   //-- btnjNode
                    "show",                     //-- newBtnText
                    newNode,                    //-- jmpTblRow
                    "gmEaCandidateHidden",      //-- jmpTblClass
                    0                           //-- cvTblColIdx
                );
                userPost.hide ();
            }
        }
    } );
    updateCandTotals ();

    //--- Wait for button votes to be ajaxed in.
    if (onPrimaryPg) {
        window.settleAjax  = waitForSettling (sortAndSaveVoteResults);

        waitForKeyElements (".vote-election-primary > .vote-down-on", rejectDwnvotedUser);
    }
    else if (onElectionPg) {
        waitForKeyElements (".candidate-vote-buttons > .selected-choice", highlightVotedForUser);
    }

    /*---------------------------------------------------
    Now activate the controls.
    */
    //--- Min/Max button
    $("#gmEaElectionOverlay > button").click ( function () {
        var bMinimize   = $("#gmEaScrollableWrap").is (":visible");

        $(this).html (bMinimize ? "&#x23EC;" : "&#x23EB;");

        if (bMinimize)
            $("#gmEaElectionOverlay").css ( {height: "auto", opacity: "0.5"} );
        else
            $("#gmEaElectionOverlay").css ( {height: "", opacity: ""} );

        $("#gmEaSlideToggleWrap").slideToggle (200);
    } );

    //--- Save button
    $("#gmEaSave").click ( function () {
        saveFilterData ();

        //-- Give user feedback
        var gm_saveBtn      = $("#gmEaSave")[0];
        var gm_msgOptions   = { position: {at: "left top", my: "right bottom"} };

        unsafeWindow.gm_msgOptions  = cloneInto (gm_msgOptions, unsafeWindow);

        unsafeWindow.StackExchange.helpers.showInfoMessage (
            gm_saveBtn,
            "Saved your filter state!",
            unsafeWindow.gm_msgOptions
        );
    } );

    //--- Sort buttons:
    $("#gmEaMetaControls").on ("change", "input[type='radio']",  function (zEvent) {
        var srtMode     = $(this).val ();   //-- `name` or `score`
        sortJumpTable (srtMode);
    } );

    //--- Hide/Show comments button:
    $("#gmEaHideComments").click ( function () {
        var jThis       = $(this);
        var bHideEm     = /Hide/.test (jThis.text() );
        var newBtnText  = bHideEm ? "Show comments" : "Hide comments";
        jThis.text (newBtnText);

        if (bHideEm)
            $(".comment").hide ();
        else
            $(".comment").show ();
    } );

    //--- Hide/Show candidates buttons:
    jmpTable.on ("click", ".gmEaHideBtn",  function (zEvent, option_1) {
        var jThis       = $(this);
        var bHideEm     = /hide/.test (jThis.text() );

        if (option_1 === "forceHide")   bHideEm = true;
        var newBtnText  = bHideEm ? "show" : "hide";
        var thisRow     = jThis.parent ().parent ();
        var userPost    = upDateCandidateStatus (
            bHideEm,                //-- bApply
            jThis,                  //-- btnjNode
            newBtnText,             //-- newBtnText
            thisRow,                //-- jmpTblRow
            "gmEaCandidateHidden",  //-- jmpTblClass
            0                       //-- cvTblColIdx
        );

        if (bHideEm) {
            userPost.hide ();
        }
        else {
            userPost.show ();
        }
    } );

    //--- Reject/Clear candidates buttons:
    jmpTable.on ("click", ".gmEaRejectBtn",  function (zEvent) {
        var jThis       = $(this);
        var bRejctEm    = /reject/.test (jThis.text() );
        var newBtnText  = bRejctEm ? "clear" : "reject";
        var thisRow     = jThis.parent ().parent ();
        var userPost    = upDateCandidateStatus (
            bRejctEm,                   //-- bApply
            jThis,                      //-- btnjNode
            newBtnText,                 //-- newBtnText
            thisRow,                    //-- jmpTblRow
            "gmEaCandidateRejected",    //-- jmpTblClass
            8                           //-- cvTblColIdx
        );

        if (bRejctEm) {
            userPost.css ("background", "darkred");
        }
        else {
            userPost.css ("background", "");
        }

        //--- Now auto hide the entry too.
        if (bRejctEm) {
            thisRow.find (".gmEaHideBtn").trigger ("click", ["forceHide"]);
        }
    } );

    //--- Like/Clear candidates buttons:
    jmpTable.on ("click", ".gmEaLikeBtn",  function (zEvent) {
        var jThis       = $(this);
        var bLikeEm     = /like/.test (jThis.text() );
        var newBtnText  = bLikeEm ? "clear" : "like";
        var thisRow     = jThis.parent ().parent ();
        var userPost    = upDateCandidateStatus (
            bLikeEm,                    //-- bApply
            jThis,                      //-- btnjNode
            newBtnText,                 //-- newBtnText
            thisRow,                    //-- jmpTblRow
            "gmEaCandidateLiked",       //-- jmpTblClass
            11                          //-- cvTblColIdx
        );

        if (bLikeEm) {
            userPost.css ("background", "#ffffb3");
        }
        else {
            userPost.css ("background", "");
        }
    } );

    //--- Hide/Show all Candidates button:
    $("#gmEaHideCandidates").click ( function () {
        var jThis       = $(this);
        var bHideEm     = /Hide/.test (jThis.text() ) + 0;
        var newBtnText  = bHideEm ? "Show all" : "Hide all";
        jThis.text (newBtnText);

        $.each (candVitals, function () {
            if (this[10]) {   //-- isOnPage
                this[0] = bHideEm;
            }
        } );

        if (bHideEm) {
            candidates.hide ();
            jmpTable.find ("tr").addClass ("gmEaCandidateHidden")
                .find (".gmEaHideBtn").text ('show')
                ;
            displayCandTotals (0);
        }
        else {
            candidates.show ();
            jmpTable.find ("tr").removeClass ("gmEaCandidateHidden")
                .find (".gmEaHideBtn").text ('hide')
                ;
            updateCandTotals ();
        }
    } );

    //--- Click User entries to scroll:
    jmpTable.on ("click", ".gmEaClickable",  function (zEvent) {
        var jThis       = $(this);
        var thisRow     = jThis.parent ();
        var userId      = thisRow.data ("user-id");
        var candData    = $.map (candVitals, function (candEntry, J) {
            if (userId == candEntry[4]) {
                return candEntry;
            }
            return null;
        } );
        var postId      = candData[3];
        var userPost    = $('#' + postId + ', tr[data-candidate-id=' + postId + ']');

        var trgtOffsetY = userPost.offset ().top;
        window.scrollTo (0, trgtOffsetY);
    } );

    $("#gmEaElectionOverlay").css ("width", "").fadeIn (400);
}


/*---------------------------------------------------
Functions don't need to be wrapped.
*/
function rejectDwnvotedUser (jNode) {
    var userPost    = jNode.parentsUntil ("[id^='post-']").last ().parent ();
    var postId      = userPost.attr ("id");
    var candData    = $.map (candVitals, function (candEntry, J) {
        if (postId == candEntry[3]) {
            return candEntry;
        }
        return null;
    } );
    var userId      = candData[4];
    var jmpTblRow   = jmpTable.find ("tr[data-user-id=" + userId + "]");
    var btnjNode    = jmpTblRow.find (".gmEaRejectBtn");

    upDateCandidateStatus (
        true,                       //-- bApply
        btnjNode,                   //-- btnjNode
        "clear",                    //-- newBtnText
        jmpTblRow,                  //-- jmpTblRow
        "gmEaCandidateRejected",    //-- jmpTblClass
        8                           //-- cvTblColIdx
    );

    btnjNode        = jmpTblRow.find (".gmEaHideBtn");
    upDateCandidateStatus (
        true,                       //-- bApply
        btnjNode,                   //-- btnjNode
        "show",                     //-- newBtnText
        jmpTblRow,                  //-- jmpTblRow
        "gmEaCandidateHidden",      //-- jmpTblClass
        0                           //-- cvTblColIdx
    );
    userPost.css ("background", "darkred");
    userPost.hide ();

    settleAjax.trigger ();  //-- sortAndSaveVoteResults() will be called after last wfke event finishes.
}

function highlightVotedForUser (jNode) {
    var userPost    = jNode.parentsUntil (".candidate-row").last ().parent ();
    var postId      = userPost.data ("candidateId");
    var candData    = $.map (candVitals, function (candEntry, J) {
        if (postId == candEntry[3]) {
            return candEntry;
        }
        return null;
    } );
    var userId      = candData[4];
    var jmpTblRow   = jmpTable.find ("tr[data-user-id=" + userId + "]");
    jmpTblRow.addClass ("gmEaCandidateVotedFor");

    //-- Auto like them for now.
    var btnjNode    = jmpTblRow.find (".gmEaLikeBtn");
    var userPost    = upDateCandidateStatus (
        true,                       //-- bApply
        btnjNode,                   //-- btnjNode
        "clear",                    //-- newBtnText
        jmpTblRow,                  //-- jmpTblRow
        "gmEaCandidateLiked",       //-- jmpTblClass
        11                          //-- cvTblColIdx
    );
    userPost.css ("background", "#ffffb3");

    sortAndSaveVoteResults ();
}

function sortAndSaveVoteResults () {
    sortJumpTable ("score");

    saveFilterData ();
}

function saveFilterData () {
    var toSave  = {0: [1,2,3,4]};

    for (var J = candVitals.length - 1;  J >= 0;  --J) {
        var candEntry   = candVitals[J];
        var userId      = candEntry[4];
        var newRow      = [
            candEntry[0] ,  //-- hideUser
            candEntry[8] ,  //-- rejected
            candEntry[11],  //-- liked
            candEntry[9]    //-- dwnVoted
        ];

        toSave[userId]  = newRow;
    }

    GM_setValue (siteNameKey, JSON.stringify (toSave) );
}

function sortJumpTable (srtMode) {  //-- `name` or `score`
    candVitals      = candVitals.sort (sortByName);
    if (srtMode === "score") {
        candVitals  = candVitals.sort (sortByScore);
    }

    //--- Sort in place using the master array as a guide.
    $.each (candVitals, function () {
        if (this[10]) {   //-- isOnPage
            var userId      = this[4];
            var matchingRow = jmpTable.find ('tr[data-user-id=' + userId + ']');

            jmpTable.append (matchingRow);
        }
    } );
}

function upDateCandidateStatus (
    bApply,         //-- Adds class when true, clears it otherwise
    btnjNode,
    newBtnText,
    jmpTblRow,
    jmpTblClass,
    cvTblColIdx
) {
    btnjNode.text (newBtnText);

    var userId      = jmpTblRow.data ("user-id");

    //TBD: Update display totals inside this map, so not looping through array twice.
    var rowKey      = -1;
    var candData    = $.map (candVitals, function (candEntry, J) {
        if (userId == candEntry[4]) {
            rowKey  = J;
            return candEntry;
        }
        return null;
    } );
    var postId      = candData[3];
    var userPost    = $('#' + postId + ', tr[data-candidate-id=' + postId + ']');

    //--- Update Master array
    if (candVitals[rowKey]) {
        candVitals[rowKey][cvTblColIdx]   = bApply + 0;  // convert bool to int, if necessary

        if (bApply) {
            jmpTblRow.addClass (jmpTblClass);
        }
        else {
            jmpTblRow.removeClass (jmpTblClass);
        }
        updateCandTotals ();

        return userPost;
    }
}


/*---------------------------------------------------
Helper functions
*/
function updateCandTotals () {
    var candidatesInPlay = 0;

    $.each (candVitals, function () {
        var hideUser    = this[0],
            rejected    = this[8],
            dwnVoted    = this[9],
            isOnPage    = this[10];

        if (isOnPage  &&  ! hideUser  &&  ! rejected) {
            candidatesInPlay++;
        }
    } );

    displayCandTotals (candidatesInPlay);
}
function displayCandTotals (candidatesInPlay) {
    $("#gmEaUsers").text ('(' + candidatesInPlay + ' of ' + candidates.length + ')');
}

function sortByName (zA, zB) {
    var hdrChecks   = commonHousekeepingSort (zA, zB);
    if (hdrChecks !== 0)    return hdrChecks;

    var nameA       = zA[1].toLowerCase ();
    var nameB       = zB[1].toLowerCase ();

    return nameA.localeCompare (nameB);
}
function sortByScore (zA, zB) {
    var hdrChecks   = commonHousekeepingSort (zA, zB);
    if (hdrChecks !== 0)    return hdrChecks;

    var scoreA      = zA[2];
    var scoreB      = zB[2];

    //--- Sort score descending:
    return (scoreB - scoreA);
}
function commonHousekeepingSort (zA, zB) {
    /*--- Sort Orders as follows:
        1) If the candidate is not on this page, then he goes to the very bottom.
        2) Liked users are up top.
        3) Next up, from the bottom are rejected candidates.
        4) Then, hidden candidates are after unhidden.
        5) Sort by whatever criteria (name, score, etc.)
    */
    //-- isOnPage
    if      (zA[10] < zB[10])  return -1;
    else if (zA[10] > zB[10])  return  1;
    //-- liked
    if      (zA[11] > zB[11])  return -1;
    else if (zA[11] < zB[11])  return  1;
    //-- rejected
    if      ( zA[8] < zB[8])   return -1;
    else if ( zA[8] > zB[8])   return  1;
    //-- hideUser
    if      ( zA[0] < zB[0])   return -1;
    else if ( zA[0] > zB[0])   return  1;

    return  0;
}

if (onSEMC_pages) {
    //--- On "Stack Exchange Moderator Candidate Statistics" pages.
    GM_addStyle ( `
        #gmEaStatusAlert {
            background:     lime none repeat scroll 0 0;
            border:         1px solid darkblue;
            border-radius:  0.25rem;
            left:           25vw;
            opacity:        1;
            overflow:       hidden;
            padding:        1rem 2rem;
            position:       fixed;
            top:            2rem;
            width:          calc(50vw - 4rem);
            z-index:        888;
        }
        #gmEaStatusAlert > h2 {
            font-size:      2rem;
            line-height:    1.2;
        }
        #gmEaStatusAlert > button {
            position:       absolute;
            right:          0;
            top:            0;
            font-size:      0.4rem;
            padding:        0 0.3rem 0.2rem 0.3rem;
            background:     gray;
            color:          white;
            top:            -2px;
        }
        #gmEaStatusAlert button:hover {
            color:          red;
        }
        .gmEaUserID {
            font-style:     italic;
        }
    ` );
}
else {
    //--- On main election pages.
    GM_addStyle ( `
        #gmEaElectionOverlay {
            background:     #f0fff0;
            border:         1px solid darkblue;
            border-radius:  0.5rem;
            overflow:       hidden;
            padding:        0.5rem 0.4rem 0.5rem 0.8rem;
            position:       fixed;
            right:          0.1rem;
            top:            1rem;
            width:          20rem;
            height:         90vh;
            max-height:     90vh;
            z-index:        888;
        }
        #gmEaElectionOverlay > h3 {
            margin-bottom:  0.5rem;
        }
        #gmEaElectionOverlay > button {
            position:       absolute;
            right:          0;
            top:            0;
            font-size:      0.7rem;
            padding:        0 0.3rem 0.2rem 0.3rem;
            background:     gray;
        }
        #gmEaElectionOverlay button:hover {
            color:          red;
        }
        #gmEaScrollableWrap {
            max-height:     calc(100% - 5.5rem);
            overflow-x:     hidden;
            overflow-y:     auto;
        }
        #gmEaHideCandidates, #gmEaHideComments, #gmEaSave {
            font-size:      0.5rem;
            font-weight:    bold;
            margin-right:   0.4rem;
            padding:        0.3rem 0.5rem;
        }
        #gmEaSave {
            background:     lightcoral;
            float:          right;
        }
        #gmEaSave:hover {
            color:          black !important;
        }
        .gmEaHideBtn, .gmEaRejectBtn, .gmEaLikeBtn {
            font-size:      0.5rem;
            margin:         0.1rem 0.3rem 0.1rem 0;
            padding:        0.1rem 0.2rem;
        }
        #gmEaMetaControls {
            margin-bottom:  0;
            margin-top:     1rem;
        }
        #gmEaScrollableWrap > table {
            background:     white;
        }
        #gmEaScrollableWrap > table > tbody > tr:nth-child(even) {
            background:     #f0ffff;
        }
        #gmEaScrollableWrap > table > tbody > tr:hover {
            background:     #ffffb3;
        }
        #gmEaScrollableWrap > table > tbody > tr > td {
            padding:        3px 0.5rem 3px 2px;
            white-space:    nowrap;
        }
        #gmEaScrollableWrap > table > tbody > tr > td:nth-child(4) {
            white-space:    normal;
            padding:        3px 2px;
        }
        label, .gmEaClickable {
            cursor:         pointer;
        }
        .gmEaResetTableBtns, .gmEaSortTableBtns {
            display:        inline-block;
            vertical-align: top;
            clear:          none;
        }
        .gmEaSortTableBtns {
            margin-top:     -0.8rem;
        }
        #gmEaScrollableWrap > table > tbody > tr.gmEaCandidateHidden {
            background:     gray;
        }
        #gmEaScrollableWrap > table > tbody > tr.gmEaCandidateRejected {
            background:     darkred;
        }
        #gmEaScrollableWrap > table > tbody > tr.gmEaCandidateLiked {
            background:     #FFD700;  // Gold color
        }
        #gmEaScrollableWrap > table > tbody > tr.gmEaCandidateVotedFor {
            background:     lime;
            border:         5px solid orange;
        }
        #gmEaSlideToggleWrap {
            height:         100%;
        }
        .gmEaTabs {
            clear:          both;
            border-bottom:  1px solid gray;
            padding-bottom: 1px;
        }
        .gmEaTabs > a {
            border:         1px solid gray;
            background:     #f8f8f8;
            color:          black;
            margin:         0 -1px 0 0;
            padding:        0.1rem 0.6rem;
        }
        .gmEaTabs > a:hover {
            color:          red;
            background:     #ffffb3;
        }
        .gmEaSelected {
            background:     white !important;
            border-bottom:  1px solid white !important;
        }
        .gmEaStopOverflow {
            max-width:      5.2rem;
            overflow:       hidden;
        }
        #gmEaScrollableWrap > table > tbody > tr > td > a {
            margin-right:   1rem;
        }
        #gmEaScrollableWrap > table > tbody > tr > td > a:hover {
            color:          red;
            text-decoration: underline;
        }
    ` );
}


/*---------------------------------------------------
Standard support funcs
*/
function getUrlParameters () {
    var params  = {};

    if (location.search) {
        var qryStr      = location.search.substr (1); // strip off leading '?'
        var nvPairs     = qryStr.split ("&");

        for (J = nvPairs.length - 1;  J >= 0;  --J) {
            var nvPair      = nvPairs[J].split ("=");
            var name        = decodeURIComponent (nvPair[0]);
            var value       = decodeURIComponent (nvPair[1] || "");

            params[name]    = value;
        }
    }
    return params;
}

function rehashURL (locationOrHref, newHash) {
    var finalHash   = newHash  ?  '#' + newHash  :  "";
    var newURL      = location.protocol + "//"
                    + location.host
                    + location.pathname
                    + location.search
                    + finalHash     // location.hash
                    ;
    return (newURL);
}

function urlToHrefObj (sUrl) {
    var locateObj   = {}
    var locProps    = ["protocol", "host", "pathname", "search", "hash"];
    var node        = document.createElement ("a");
    node.setAttribute ("href", sUrl);

    for (var J = locProps.length - 1;  J >= 0;  J--) {
        var key         = locProps[J];
        var value       = node[key];
        if (key === 'search'  ||  key === 'hash')
            value       = value.slice (1);

        locateObj[key]  = value;
    }

    return locateObj;
}

function hrefObjToUrl (uObj) {
    var finalHash   = uObj.hash     ?  '#' + uObj.hash    :  "";
    var finalSearch = uObj.search   ?  '?' + uObj.search  :  "";
    var newURL      = uObj.protocol + "//"
                    + uObj.host
                    + uObj.pathname
                    + finalSearch
                    + finalHash
                    ;
    return (newURL);
}

function cloneSimpleObject (oldObject) {
    return JSON.parse (JSON.stringify (oldObject) );
}

function waitForSettling (callbackFunc, iDelay, context) {
    "use strict";
    var iTimer          = null;
    var iDelay          = iDelay  ||  200;
    var fireCount       = 0;
    var triggerCount    = 0;

    function _stats () {
        return {
            mssg:       'Triggered ' + triggerCount + ' times and fired ' + fireCount + ' times.',
            fired:      fireCount,
            triggered:  triggerCount
        }
    }
    function _reset () {
        fireCount       = 0;
        triggerCount    = 0;
        clearTimer ();
    }
    function _trigger (delayOverride) {
        triggerCount++;
        var thisDelay   = delayOverride  ||  iDelay;

        if (typeof iTimer == "number")   clearTimer ();

        iTimer  = setTimeout (fireCallback, thisDelay);
    }
    function clearTimer () {
        clearTimeout (iTimer);
        iTimer  = null;
    }
    function fireCallback () {
        fireCount++;
        callbackFunc (context);
    }
    return {
        trigger:    _trigger,
        reset:      _reset,
        stats:      _stats
    };
}

function chaseNodeForX_seconds (jNode, numSeconds) {
    scrollToNode (jNode, false);

    var K           = 0;
    var maxK        = numSeconds * 50;

    var sttlIntrvl  = setInterval ( function () {
        K++;
        if (K >= maxK)  clearInterval (sttlIntrvl);

        scrollToNode (jNode, true);
    }, 20); // TS studies show 20 is min "open loop" number.
}

function scrollToNode (jNode, useRunningAvg) {
    var trgtOffsetY = jNode.offset ().top;
    var useOffsetY;
    scrollToNode.Sum      = scrollToNode.Sum     || 0;
    scrollToNode.rnngN    = scrollToNode.rnngN   || 0;
    scrollToNode.lstPosY  = scrollToNode.lstPosY || 0;

    if (useRunningAvg) {
        var sampSz  = 4;
        var Sum     = scrollToNode.Sum;
        var rnngN   = scrollToNode.rnngN;
        var lstPosY = scrollToNode.lstPosY;

        var newSum  = ( (Sum * rnngN) + trgtOffsetY)  /  (rnngN + 1);

        useOffsetY  = Math.floor (newSum);
        //-- Kill occassional jitter
        useOffsetY  = Math.abs(lstPosY - useOffsetY) > 1  ?  useOffsetY  :  Math.min (lstPosY, useOffsetY);

        rnngN       = (rnngN >= sampSz-1)  ?  (sampSz-1)  : rnngN + 1;
        scrollToNode.Sum      = newSum;
        scrollToNode.rnngN    = rnngN;
        scrollToNode.lstPosY  = useOffsetY;
    }
    else {
        useOffsetY  = Math.floor (trgtOffsetY);
        scrollToNode.Sum      = 0;
        scrollToNode.rnngN    = 0;
    }

    window.scrollTo (0, useOffsetY);
}


/*---------------------------------------------------
Main for second set of pages.
*/
function SEMC_main () {
    document.title  = gblUserName + ' election info';

    $("body").prepend (
          '<div id="gmEaStatusAlert">\n'
        + '    <h2>Waiting for user <span class=".gmEaUserID">' + gblUserName + '</span> to appear in the page below.</h2>\n'
        + '    <button>&#x2573;</button>\n'
        + '</div>\n'
    );

    $("#gmEaStatusAlert > button").click ( function () {
        $("#gmEaStatusAlert").hide ();
    } );

    waitForKeyElements ("#user-" + gblUserId, scrollToIt);
}

function scrollToIt (jNode) {
    $("#gmEaStatusAlert > h2").html (
        'Found user ' + gblUserName + '. &nbsp; Now waiting for the entry to quit bouncing around the page. :)' +
        ' &nbsp; This may take several seconds.'
    )
    .parent ().css ("opacity", "0.8");

    $("#gmEaStatusAlert").delay (2500).fadeOut (1000);

    chaseNodeForX_seconds (jNode, 4);
}
