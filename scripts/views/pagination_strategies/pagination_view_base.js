// Description: Base class from which all pagination strategy classes are derived. This
//	 class should not be intialized (if it could be it would be abstract). It
//	 exists for the purpose of sharing behaviour between the different pagination strategies.

Readium.Views.PaginationViewBase = Backbone.View.extend({

	// all strategies are linked to the same dom elem
	el: "#readium-book-view-el",

	// this doesn't seem to be working...
	events: {
		"click #page-margin": function(e) {
			this.trigger("toggle_ui");
		},

		"click #readium-content-container a": function(e) {
			this.linkClickHandler(e);
		}
	},

	/**************************************************************************************/
	/* PUBLIC METHODS (THE API)                                                           */
	/**************************************************************************************/

	initialize: function(options) {
		
		this.pages = new Readium.Models.EPUBPagination({epubController : this.model});

		this.pages.on("change:current_page", this.changePage, this);
		this.model.on("change:font_size", this.setFontSize, this);
		this.model.on("change:hash_fragment", this.goToHashFragment, this);
		this.bindingTemplate = _.template( $('#binding-template').html() );

		// START: Refactored from ebook.js
		// if content reflows and the number of pages in the section changes
		// we need to adjust the the current page
		this.model.on("change:num_pages", this.adjustCurrentPage, this);
		// END: Refactored from ebook.js
	},

	// Note: One of the primary members of the public interface; called by all three pagination views
    iframeLoadCallback: function(e) {
		
		this.applyBindings( $(e.srcElement).contents() );
		this.applySwitches( $(e.srcElement).contents() );
		this.addSwipeHandlers( $(e.srcElement).contents() );
        this.injectMathJax(e.srcElement);
        this.injectLinkHandler(e.srcElement);
        var trigs = this.parseTriggers(e.srcElement.contentDocument);
		this.applyTriggers(e.srcElement.contentDocument, trigs);
	},

	// handle clicks of anchor tags by navigating to
	// the proper location in the epub spine, or opening
	// a new window for external links
	linkClickHandler: function(e) {
		e.preventDefault();

		var href = e.srcElement.attributes["href"].value;
		if(href.match(/^http(s)?:/)) {
			chrome.tabs.create({"url": href});
		} else {
			this.model.goToHref(href);
		}
	},

	// TODO: Only used in reflowable view
	goToHashFragment: function() {
		// stub this in to the super class as a no-op for now
		// just to prevent "no method error"s
	},

	// TODO: This method is only called by the reflowable view and should be moved there
	/*
     * Description: Activates a style set for the ePub, based on the currently selected theme. At present, 
     * only the day-night alternate tags are available as an option. 
    */
	activateEPubStyle: function(bookDom) {

	    var selector;
		
		// Apply night theme for the book; nothing will be applied if the ePub's style sheets do not contain a style
		// set with the 'night' tag
	    if (this.model.get("current_theme") === "night-theme") {

	    	selector = new Readium.Models.AlternateStyleTagSelector;
	    	bookDom = selector.activateAlternateStyleSet(["night"], bookDom);

	    }
	    else {

			selector = new Readium.Models.AlternateStyleTagSelector;
	    	bookDom = selector.activateAlternateStyleSet([""], bookDom);
	    }
	},

	// Description: Changes between having one or two pages displayed. 
	setUpMode: function() {
		var two_up = this.model.get("two_up");
		this.$el.toggleClass("two-up", two_up);
		this.$('#spine-divider').toggle(two_up);
	},

	changePage: function() {
		var that = this;
		var currentPage = this.pages.get("current_page");
		var two_up = this.model.get("two_up");
		this.$(".page-wrap").each(function(index) {
			if(!two_up) { 
				index += 1;
			}
			$(this).toggleClass("hidden-page", !that.pages.isPageVisible(index, currentPage));
		});
	},

	// REFACTORING CANDIDATE: Child models "override" this; investigate this
	setFontSize: function() {
		var size = this.model.get("font_size") / 10;
		$('#readium-content-container').css("font-size", size + "em");
		this.renderPages();
	},

	/**************************************************************************************/
	/* "PRIVATE" HELPERS                                                                  */
	/**************************************************************************************/

	// sometimes these views hang around in memory before
	// the GC gets them. we need to remove all of the handlers
	// that were registered on the model
	destruct: function() {
		console.log("Pagination base destructor called");

		// remove any listeners registered on the model
		this.pages.off("change:current_page", this.changePage);
		this.model.off("change:font_size", this.setFontSize);
		this.model.off("change:hash_fragment", this.goToHashFragment);
		this.model.off("change:num_pages", this.adjustCurrentPage, this);
		this.resetEl();
	},
	
	getBindings: function() {
		var packDoc = this.model.epub.getPackageDocument();
		var bindings = packDoc.get('bindings');
		return bindings.map(function(binding) {
			binding.selector = 'object[type="' + binding.media_type + '"]';
			binding.url = packDoc.getManifestItemById(binding.handler).get('href');
			binding.url = packDoc.resolveUri(binding.url);
			return binding;
		})
	},

	applyBindings: function(dom) {
		var that = this;
		var bindings = this.getBindings();
		var i = 0;
		for(var i = 0; i < bindings.length; i++) {
			$(bindings[i].selector, dom).each(function() {
				var params = [];
				var $el = $(this);
				var data = $el.attr('data');
				var url;
				params.push("src=" + that.model.packageDocument.resolveUri(data));
				params.push('type=' + bindings[i].media_type);
				url = bindings[i].url + "?" + params.join('&');
				var content = $(that.bindingTemplate({}));
				// must set src attr separately
				content.attr('src', url);
				$el.html(content);
			});
		}
	},

	applyTriggers: function(dom, triggers) {
		for(var i = 0 ; i < triggers.length; i++) {
			triggers[i].subscribe(dom);
		}
	},

	// for reflowable content we only add what is in the body tag.
	// lots of times the triggers are in the head of the dom
	parseTriggers: function(dom) {
		var triggers = [];
		$('trigger', dom).each(function() {
			

			triggers.push(new Readium.Models.Trigger(this) );
		});
		
		return triggers;
	},	

	// parse the epub "switch" tags and hide
	// cases that are not supported
	applySwitches: function(dom) {

		// helper method, returns true if a given case node
		// is supported, false otherwise
		var isSupported = function(caseNode) {

			var ns = caseNode.attributes["required-namespace"];
			if(!ns) {
				// the namespace was not specified, that should
				// never happen, we don't support it then
				console.log("Encountered a case statement with no required-namespace");
				return false;
			}
			// all the xmlns's that readium is known to support
			// TODO this is going to require maintanence
			var supportedNamespaces = ["http://www.w3.org/1998/Math/MathML"];
			return _.include(supportedNamespaces, ns);
		};

		$('switch', dom).each(function(ind) {
			
			// keep track of whether or now we found one
			var found = false;

			$('case', this).each(function() {

				if( !found && isSupported(this) ) {
					found = true; // we found the node, don't remove it
				}
				else {
					$(this).remove(); // remove the node from the dom
				}
			});

			if(found) {
				// if we found a supported case, remove the default
				$('default', this).remove();
			}
		})
	},

	addSwipeHandlers: function(dom) {
		var that = this;
		$(dom).on("swipeleft", function(e) {
			e.preventDefault();
			that.pages.goRight();
			
		});

		$(dom).on("swiperight", function(e) {
			e.preventDefault();
			that.pages.goLeft();
		});
	},

	replaceContent: function(content) {
		// TODO: put this where it belongs
		this.$('#readium-content-container').
		css('visibility', 'hidden').
		html(content).append("<div id='content-end'></div>");
	},

	// TODO: This appears to be dead code
	toggleTwoUp: function() {
		//this.render();
	},

	// inject mathML parsing code into an iframe
    injectMathJax: function (iframe) {
		var doc = iframe.contentDocument;
		var script = doc.createElement("script");
		script.type = "text/javascript";
		script.src = MathJax.Hub.config.root+"/MathJax.js?config=readium-iframe";
		doc.getElementsByTagName("head")[0].appendChild(script);
    },

    injectLinkHandler: function(iframe) {
    	var that = this;
    	$('a', iframe.contentDocument).click(function(e) {
    		that.linkClickHandler(e)
    	});
    },

    resetEl: function() {
    	$('body').removeClass("apple-fixed-layout");
    	$("#readium-book-view-el").attr("style", "");
		this.$el.toggleClass("two-up", false);
		this.$('#spine-divider').toggle(false);

    	this.replaceContent("");
    	$('#page-wrap').css({
    		"position": "relative",
    		"right": "0px", 
    		"top": "0px",
    		"-webkit-transform": "scale(1.0) translate(0px, 0px)"
    	});
    }
});