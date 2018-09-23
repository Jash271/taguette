/*
 * Table of contents
 *
 * - Utilities
 * - Selection stuff
 * - Project metadata
 * - Documents list
 * - Add document
 * - Tags list
 * - Highlights
 * - Add highlight
 * - Load contents
 * - Long polling


/*
 * Utilities
 */

if(!Object.entries) {
  Object.entries = function(obj) {
    var ownProps = Object.keys(obj),
      i = ownProps.length,
      resArray = new Array(i); // preallocate the Array
    while(i--) {
      resArray[i] = [ownProps[i], obj[ownProps[i]]];
    }

    return resArray;
  };
}

function encodeGetParams(params) {
  return Object.entries(params)
    .filter(function(kv) { return kv[1] !== undefined; })
    .map(function(kv) { return kv.map(encodeURIComponent).join("="); })
    .join("&");
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function nextElement(node) {
  while(node && !node.nextSibling) {
    node = node.parentNode;
  }
  if(!node) {
    return null;
  }
  node = node.nextSibling;
  while(node.firstChild) {
    node = node.firstChild;
  }
  return node;
}

function getPageXY(e) {
  // from jQuery
  // Calculate pageX/Y if missing
  if(e.pageX == null) {
    var doc = document.documentElement, body = document.body;
    var x = e.clientX + (doc && doc.scrollLeft || body && body.scrollLeft || 0) - (doc.clientLeft || 0);
    var y = e.clientY + (doc && doc.scrollTop || body && body.scrollTop || 0) - (doc.clientTop || 0);
    return {x: x, y: y};
  }
  return {x: e.pageX, y: e.pageY};
}

function getCookie(name) {
  var r = document.cookie.match("\\b" + name + "=([^;]*)\\b");
  return r ? r[1] : undefined;
}

function getJSON(url='', args) {
  if(args) {
    args = '&' + encodeGetParams(args);
  } else {
    args = '';
  }
  return fetch(
    url + '?_xsrf=' + encodeURIComponent(getCookie('_xsrf')) + args,
    {
      credentials: 'same-origin',
      mode: 'same-origin'
    }
  ).then(function(response) {
    if(response.status != 200) {
      throw "Status " + response.status;
    }
    return response.json();
  });
}

function postJSON(url='', data={}, args) {
  if(args) {
    args = '&' + encodeGetParams(args);
  } else {
    args = '';
  }
  return fetch(
    url + '?_xsrf=' + encodeURIComponent(getCookie('_xsrf')) + args,
    {
      credentials: 'same-origin',
      mode: 'same-origin',
      cache: 'no-cache',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(data)
    }
  ).then(function(response) {
    if(response.status != 200) {
      throw "Status " + response.status;
    }
    return response.json();
  });
}


/*
 * Selection stuff
 */

var chunk_offsets = [];

// Get the document offset from a position
function describePos(node, offset) {
  while(!node.id) {
    if(node.previousSibling) {
      node = node.previousSibling;
      offset += node.textContent.length;
    } else {
      node = node.parentNode;
    }
  }
  if(node.id.substring(0, 11) != 'doc-offset-') {
    return null;
  }
  return parseInt(node.id.substring(11)) + offset;
}

// Find a position from the document offset
function locatePos(pos) {
  // Find the right chunk
  var chunk_start = 0;
  for(var i = 0; i < chunk_offsets.length; ++i) {
    if(chunk_offsets[i] > pos) {
      break;
    }
    chunk_start = chunk_offsets[i];
  }

  var offset = pos - chunk_start;
  var node = document.getElementById('doc-offset-' + chunk_start);
  while(node.firstChild) {
    node = node.firstChild;
  }
  while(offset > 0) {
    if(node.textContent.length >= offset) {
      break;
    } else {
      offset -= node.textContent.length;
      node = nextElement(node);
    }
  }
  return [node, offset]
}

var current_selection = null;

// Describe the selection e.g. [14, 56]
function describeSelection() {
  var sel = window.getSelection();
  if(sel.rangeCount != 0) {
    var range = sel.getRangeAt(0);
    if(!range.collapsed) {
      var start = describePos(range.startContainer, range.startOffset);
      var end = describePos(range.endContainer, range.endOffset);
      if(start != null && end != null) {
        return [start, end];
      }
    }
  }
  return null;
}

// Restore a described selection
function restoreSelection(saved) {
  var sel = window.getSelection();
  sel.removeAllRanges();
  if(saved !== null) {
    var range = document.createRange();
    var start = locatePos(saved[0]);
    var end = locatePos(saved[1]);
    range.setStart(start[0], start[1]);
    range.setEnd(end[0], end[1]);
    sel.addRange(range);
  }
}

function splitAtPos(pos, after) {
  if(pos[1] == 0) {
    return pos[0];
  } else if(pos[1] == pos[0].textContent.length) {
    return nextElement(pos[0]);
  } else {
    return pos[0].splitText(pos[1]);
  }
}

// Highlight a described selection
function highlightSelection(saved, id) {
  console.log("Highlighting", saved);
  if(saved == null) {
    return;
  }
  var start = locatePos(saved[0]);
  start = splitAtPos(start, false);
  var end = locatePos(saved[1]);
  end = splitAtPos(end, true);

  var node = start;
  while(node != end) {
    var next = nextElement(node);
    if(node.nodeType == 3) {
      var span = document.createElement('a');
      span.className = 'highlight highlight-' + id;
      span.setAttribute('data-highlight-id', '' + id);
      span.addEventListener('click', highlightClicked);
      node.parentNode.insertBefore(span, node);
      span.appendChild(node);
    }
    node = next;
  }
}


/*
 * Project metadata
 */

var project_name_input = document.getElementById('project-name');
var project_name = project_name_input.value;

var project_description_input = document.getElementById('project-description');
var project_description = project_description_input.value;

function setProjectMetadata(metadata, form=true) {
  if(project_name == metadata.name
   && project_description == metadata.description) {
    return;
  }
  // Update globals
  project_name = metadata.name;
  project_description = metadata.description;
  // Update form
  if(form) {
    project_name_input.value = project_name;
    project_description_input.value = project_description;
  }
  // Update elements
  var elems = document.getElementsByClassName('project-name');
  for(var i = 0; i < elems.length; ++i) {
    elems[i].textContent = project_name;
  }
  console.log("Project metadata updated");
}

function projectMetadataChanged() {
  if(project_name_input.value != project_name
   || project_description_input.value != project_description) {
    console.log("Posting project metadata update");
    var meta = {
      name: project_name_input.value,
      description: project_description_input.value
    };
    postJSON(
      '/project/' + project_id + '/meta',
      meta
    )
    .then(function(result) {
      setProjectMetadata(meta, false);
    }, function(error) {
      console.error("Failed to update project metadata:", error);
      project_name_input.value = project_name;
      project_description_input.value = project_description;
    });
  }
}

document.getElementById('project-metadata-form').addEventListener('submit', function(e) {
  projectMetadataChanged();
  e.preventDefault();
});
project_name_input.addEventListener('blur', projectMetadataChanged);
project_description_input.addEventListener('blur', projectMetadataChanged);


/*
 * Documents list
 */

var current_document = null;
var documents_list = document.getElementById('documents-list');

function updateDocumentsList() {
  // Empty the list
  while(documents_list.firstChild) {
    var first = documents_list.firstChild;
    if(first.classList
     && first.classList.contains('list-group-item-primary')) {
      break;
    }
    documents_list.removeChild(first);
  }

  // Fill up the list again
  var before = documents_list.firstChild;
  var entries = Object.entries(documents);
  for(var i = 0; i < entries.length; ++i) {
    var doc = entries[i][1];
    var url = '/project/' + project_id + '/document/' + doc.id;
    var elem = document.createElement('a');
    elem.className = 'list-group-item';
    elem.href = url;
    elem.textContent = doc.name;
    (function(doc_id, url) {
      elem.addEventListener('click', function(e) {
        window.history.pushState({'document_id': doc_id}, "Document " + doc_id, url);
        loadDocument(doc_id);
        e.preventDefault();
      });
    })(doc.id, url);
    documents_list.insertBefore(elem, before);
  }
  if(entries.length == 0) {
    var elem = document.createElement('div');
    elem.className = 'list-group-item disabled';
    elem.textContent = "There are no documents in this project yet.";
    documents_list.insertBefore(elem, before);
  }
  console.log("Documents list updated");
}

updateDocumentsList();

function addDocument(document) {
  documents['' + document.id] = document;
  updateDocumentsList();
}

function removeDocument(document_id) {
  delete documents['' + document_id];
  updateDocumentsList();
}


/*
 * Add document
 */

var document_add_modal = document.getElementById('document-add-modal');

function createDocument() {
  document.getElementById('document-add-form').reset();
  $(document_add_modal).modal();
}

var progress = document.getElementById('document-add-progress');

document.getElementById('document-add-form').addEventListener('submit', function(e) {
  console.log("Uploading document...");

  var form_data = new FormData();
  form_data.append('name',
                   document.getElementById('document-add-name').value);
  form_data.append('description',
                   document.getElementById('document-add-description').value);
  form_data.append('file',
                   document.getElementById('document-add-file').files[0]);
  form_data.append('_xsrf', getCookie('_xsrf'));

  var xhr = new XMLHttpRequest();
  xhr.responseType = 'json';
  xhr.open('POST', '/project/' + project_id + '/document/new');
  xhr.onload = function() {
    if(xhr.status == 200) {
      $(document_add_modal).modal('hide');
      document.getElementById('document-add-form').reset();
      console.log("Document upload complete");
    } else {
      console.error("Document upload failed: status", xhr.status);
      alert("Error uploading file!");
    }
  };
  xhr.onerror = function(e) {
    console.log("Document upload failed:", e);
    alert("Error uploading file!");
  }
  xhr.onprogress = function(e) {
    if(e.lengthComputable) {
      var pc = e.loaded / e.total * 100;
      progress.setAttribute('aria-valuenow', '' + pc);
      progress.style.width = pc + '%';
    }
  };
  xhr.send(form_data);

  e.preventDefault();
})


/*
 * Tags list
 */

var tags_list = document.getElementById('tags-list');
var tags_modal_list = document.getElementById('highlight-add-tags');

function updateTagsList() {
  // The list in the left panel

  // Empty the list
  while(tags_list.firstChild) {
    var first = tags_list.firstChild;
    if(first.classList
     && first.classList.contains('list-group-item-primary')) {
      break;
    }
    tags_list.removeChild(first);
  }
  // Fill up the list again
  // TODO: Show this as a tree
  var tree = {};
  var before = tags_list.firstChild;
  var entries = Object.entries(tags);
  for(var i = 0; i < entries.length; ++i) {
    var tag = entries[i][1];
    var url = '/project/' + project_id + '/tag/' + tag.id;
    var elem = document.createElement('li');
    elem.className = 'list-group-item';
    elem.innerHTML =
      '<div class="d-flex justify-content-between align-items-center">' +
      '  <div>' +
      '    <a class="expand-marker">&nbsp;</a> ' +
      '    <a href="' + url + '" id="tag-link-' + tag.id + '">' + escapeHtml(tag.path) + '</a>' +
      '  </div>' +
      '  <span href="#" class="badge badge-primary badge-pill">?</span>' + // TODO: highlight count
      '</div>' +
      '<ul class="sublist"></div>';
    tags_list.insertBefore(elem, before);
    (function(tag_id, url) {
      document.getElementById('tag-link-' + tag_id).addEventListener('click', function(e) {
        window.history.pushState({'tag_id': tag_id}, "Tag " + tag_id, url);
        loadtag(tag_id);
        e.preventDefault();
      });
    })(tag.id, url);
  }
  if(entries.length == 0) {
    var elem = document.createElement('div');
    elem.className = 'list-group-item disabled';
    elem.textContent = "There are no tags in this project yet.";
    tags_list.insertBefore(elem, before);
  }

  // The list in the highlight modal

  // Empty the list
  while(tags_modal_list.firstChild) {
    tags_modal_list.removeChild(tags_modal_list.firstChild);
  }
  // Fill up the list again
  // TODO: Show this as a tree
  var tree = {};
  var entries = Object.entries(tags);
  for(var i = 0; i < entries.length; ++i) {
    var tag = entries[i][1];
    var elem = document.createElement('li');
    elem.innerHTML =
      '<input type="checkbox" value="' + tag.id + '" name="highlight-add-tags" id="highlight-add-tags-' + tag.id + '" />' +
      '<label for="highlight-add-tags-' + tag.id + '">' + tag.path + '</label>';
    tags_modal_list.appendChild(elem);
  }
  if(entries.length == 0) {
    var elem = document.createElement('li');
    elem.textContent = "no tags";
    tags_modal_list.appendChild(elem);
  }

  console.log("Tags list updated");
}

updateTagsList();

function createTag() {
  // TODO
}


/*
 * Highlights
 */

var highlights = {};

// Add or replace a highlight
function setHighlight(highlight) {
  var id = '' + highlight.id;
  if(highlights[id]) {
    removeHighlight(highlights[id]);
  }
  highlights[id] = highlight;
  highlightSelection([highlight.start_offset, highlight.end_offset], id);
  console.log("Highlight set:", highlight);
}

// Remove a highlight
function removeHighlight(id) {
  id = '' + id;
  if(!highlights[id]) {
    return;
  }

  var highlight = highlights[id];
  delete highlights[id];
  console.log("Highlight removed:", id);

  // Loop over highlight-<id> elements
  var elements = document.getElementsByClassName('highlight-' + id);
  for(var i = 0; i < elements.length; ++i) {
    // Move children up and delete this element
    var node = elements[i];
    while(node.firstChild) {
      node.parentNode.insertBefore(node.firstChild, node);
    }
    node.parentNode.removeChild(node);
  }
}


/*
 * Add highlight
 */

var highlight_add_modal = document.getElementById('highlight-add-modal');

// Updates current_selection and visibility of the controls
function selectionChanged() {
  current_selection = describeSelection();
  if(current_selection === null) {
    document.getElementById('hlinfo').style.display = 'none';
  }
}
document.addEventListener('selectionchange', selectionChanged);

// Update controls position
function mouseIsUp(e) {
  var coords = getPageXY(e);
  var hlinfo = document.getElementById('hlinfo');
  setTimeout(function() {
    hlinfo.style.top = coords.y + 'px';
    hlinfo.style.left = coords.x + 'px';
    if(current_selection !== null) {
      hlinfo.style.display = 'block';
    }
  }, 1);
}
document.addEventListener('mouseup', mouseIsUp);

function createHighlight(selection) {
  document.getElementById('highlight-add-id').value = '';
  document.getElementById('highlight-add-start').value = selection[0];
  document.getElementById('highlight-add-end').value = selection[1];
  document.getElementById('highlight-add-form').reset();
  $(highlight_add_modal).modal();
}

// Save highlight button
document.getElementById('highlight-add-form').addEventListener('submit', function(e) {
  var highlight_id = document.getElementById('highlight-add-id').value;
  var selection = [
    document.getElementById('highlight-add-start').value,
    document.getElementById('highlight-add-end').value
  ];
  var hl_tags = [];
  var entries = Object.entries(tags);
  for(var i = 0; i < entries.length; ++i) {
    var id = entries[i][1].id;
    if(document.getElementById('highlight-add-tags-' + id).checked) {
      hl_tags.push(id);
    }
  }
  var req;
  if(highlight_id) {
    console.log("Posting update for highlight " + highlight_id);
    req = postJSON(
      '/project/' + project_id + '/document/' + current_document + '/highlight/' + highlight_id,
      {start_offset: selection[0],
       end_offset: selection[1],
       tags: hl_tags}
    );
  } else {
    console.log("Posting new highlight");
    req = postJSON(
      '/project/' + project_id + '/document/' + current_document + '/highlight/new',
      {start_offset: selection[0],
       end_offset: selection[1],
       tags: hl_tags}
    );
  }
  req.then(function() {
    console.log("Highlight posted");
    $(highlight_add_modal).modal('hide');
    document.getElementById('highlight-add-form').reset();
  }, function(error) {
    console.error("Failed to create highlight:", error);
  });

  e.preventDefault();
});

// Delete highlight button
document.getElementById('highlight-delete').addEventListener('click', function(e) {
  var highlight_id = document.getElementById('highlight-add-id').value;
  if(highlight_id) {
    highlight_id = parseInt(highlight_id);
    console.log("Posting highlight " + highlight_id + " deletion");
    postJSON(
      '/project/' + project_id + '/document/' + current_document + '/highlight/' + highlight_id,
      {}
    )
    .then(function() {
      $(highlight_add_modal).modal('hide');
      document.getElementById('highlight-add-form').reset();
    }, function(error) {
      console.error("Failed to delete highlight:", error);
    });
  }
});

// When clicking on a highlight
function highlightClicked(e) {
  document.getElementById('highlight-add-form').reset();
  var id = this.getAttribute('data-highlight-id');
  document.getElementById('highlight-add-id').value = id;
  document.getElementById('highlight-add-start').value = highlights[id].start_offset;
  document.getElementById('highlight-add-end').value = highlights[id].end_offset;
  var hl_tags = highlights['' + id].tags;
  for(var i = 0; i < hl_tags.length; ++i) {
    document.getElementById('highlight-add-tags-' + hl_tags[i]).checked = true;
  }
  $(highlight_add_modal).modal();
}


/*
 * Load contents
 */

var document_contents = document.getElementById('document-contents');

function loadDocument(document_id) {
  if(document_id === null) {
    document_contents.innerHTML = '<p style="font-style: oblique; text-align: center;">Load a document on the left</p>';
    return;
  }
  getJSON(
    '/project/' + project_id + '/document/' + document_id + '/content'
  )
  .then(function(result) {
    document_contents.innerHTML = '';
    chunk_offsets = [];
    for(var i = 0; i < result.contents.length; ++i) {
      var chunk = result.contents[i];
      var elem = document.createElement('div');
      elem.setAttribute('id', 'doc-offset-' + chunk.offset);
      elem.innerHTML = chunk.contents;
      document_contents.appendChild(elem);
      chunk_offsets.push(chunk.offset);
    }
    current_document = document_id;
    console.log("Loaded document", document_id);
    for(var i = 0; i < result.highlights.length; ++i) {
      setHighlight(result.highlights[i]);
    }
    console.log("Loaded " + result.highlights.length + " highlights")
  }, function(error) {
    console.error("Failed to load document:", error);
  });
}

function loadtag(tag_id) {
  // TODO: show highlight view
  document_contents.innerHTML = '<h1>Tag ' + tag_id + ' (' + tags['' + tag_id].path + ') here</h1>';
}

// Load the document if the URL includes one
var m = window.location.pathname.match(/\/project\/([0-9]+)\/document\/([0-9]+)/);
if(m) {
  loadDocument(parseInt(m[2]));
}
// Or a tag
m = window.location.pathname.match(/\/project\/([0-9]+)\/tag\/([0-9]+)/);
if(m) {
  loadtag(parseInt(m[2]));
}

// Load documents as we go through browser history
window.onpopstate = function(e) {
  if(e.state) {
    if(e.state.document_id != undefined) {
      loadDocument(e.state.document_id);
    } else if(e.state.tag_id != undefined) {
      loadtag(e.state.tag_id);
    } else {
      console.error("History state unrecognized");
    }
  } else {
    loadDocument(null);
  }
};


/*
 * Long polling
 */

function longPollForEvents() {
  getJSON(
    '/project/' + project_id + '/events',
    {from: last_event}
  )
  .then(function(result) {
    console.log("Polling: ", result);
    if('project_meta' in result) {
      setProjectMetadata(result.project);
    }
    if('document_add' in result) {
      for(var i = 0; i < result.document_add.length; ++i) {
        addDocument(result.document_add[i]);
      }
    }
    if('highlight_add' in result) {
      var added = result.highlight_add[current_document];
      if(added) {
        for(var i = 0; i < added.length; ++i) {
          setHighlight(added[i]);
        }
      }
    }
    if('highlight_delete' in result) {
      var removed = result.highlight_delete[current_document];
      if(removed) {
        for(var i = 0; i < removed.length; ++i) {
          removeHighlight(removed[i]);
        }
      }
    }
    last_event = result.ts;

    // Re-open connection
    setTimeout(longPollForEvents, 1000);
  }, function(error) {
    setTimeout(longPollForEvents, 5000);
  });
}
longPollForEvents();