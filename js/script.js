// scrolling animation
var requestFrame = (window.requestAnimationFrame ||
      function(callback){ window.setTimeout(callback, 1000/60); }).bind(window);

function clamp01(value) {
  if (isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

// Remember the last header state so we only toggle classes when the scroll
// position actually crosses the threshold, not on every animation frame.
// Reassigning className every frame near the threshold is what caused the
// header text to flicker.
var headerCondensed = null;

function loop() {
  var largeHeading = document.getElementsByTagName("h1")[0];
  var smallHeading = document.getElementsByTagName("h2")[0];
  if (!largeHeading || !smallHeading) {
    requestFrame(loop);
    return;
  }

  var threshold = window.innerWidth * 0.3;
  var condensed = window.scrollY > threshold;

  if (condensed) {
    smallHeading.style.opacity = clamp01(2 * (window.scrollY - threshold) / window.innerWidth / 0.3);
  } else {
    largeHeading.style.opacity = clamp01((threshold - window.scrollY) / window.innerWidth / 0.3);
  }

  // Only swap the visible/hidden heading when crossing the threshold.
  if (condensed !== headerCondensed) {
    headerCondensed = condensed;
    if (condensed) {
      largeHeading.className = "hidden";
      smallHeading.className = "";
    } else {
      largeHeading.className = "";
      smallHeading.className = "hidden";
    }
  }

  requestFrame(loop);
}

loop();

function splitTags(value) {
  if (!value) return [];
  return value
    .split(/,|;/)
    .map(function(tag) { return tag.trim(); })
    .filter(function(tag) { return tag.length > 0; });
}

function uniqueList(items) {
  return items.filter(function(item, index) {
    return item && items.indexOf(item) === index;
  });
}

// These keep the category buttons visible even while the sheet is still being filled in.
var DEFAULT_PROGRAMS = [
  'Philosophy',
  'Film and New Media',
  'Legal Studies',
  'Interactive Media',
  'Art History',
  'Literature',
  'Music'
];

// Canonical Projects column layout (matches fetch-data.py: A Order ... N Status).
// Used to repair blank header cells so a missing header in the sheet
// (e.g. the Majors column in G) can't silently drop an entire column.
var PROJECTS_HEADERS = [
  'Order',            // A
  'Class Code',       // B
  'Class Title',      // C
  'Short blurb',      // D
  'Full Description', // E
  'Professor Name',   // F
  'Majors',           // G
  'Concept Tags',     // H
  'Semester Offered', // I
  'Credits',          // J
  'Past Student Work',// K
  'Video Link',       // L
  'Tile image',       // M
  'Status'            // N
];

function repairHeaders(rawHeaders, isProjects) {
  return rawHeaders.map(function(name, index) {
    var clean = (name === undefined || name === null) ? '' : String(name).trim();
    if (clean) return clean;
    // Only repair the Projects sheet, and only by known column position.
    if (isProjects && index < PROJECTS_HEADERS.length) {
      return PROJECTS_HEADERS[index];
    }
    return clean;
  });
}


function getField(row, names) {
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    if (row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== '') {
      return row[name];
    }
  }
  return '';
}

function isGoogleDriveUrl(url) {
  return !!url && url.toLowerCase().indexOf('drive.google.com') !== -1;
}

function googleDriveToImageUrl(url) {
  if (!url) return '';
  var match = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    return 'https://drive.google.com/uc?export=view&id=' + match[1];
  }
  return url;
}

function safeFileName(value) {
  return (value || '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function resolveTileImage(imageValue, classCode) {
  if (!imageValue) return '';

  // If the sheet contains a Google Drive link, fetch-data.py downloads it into
  // data/images/CLASS_CODE.jpg. Use that local file on the website so Drive
  // permissions/hotlinking do not make the tile appear black.
  if (isGoogleDriveUrl(imageValue) && classCode) {
    return 'data/images/' + safeFileName(classCode) + '.jpg';
  }

  return googleDriveToImageUrl(imageValue);
}

class Tile {
  constructor(data) {
    this.type = data.type || 'project';
    this.order = data.order || '';
    this.classCode = data.classCode || '';
    this.title = data.title || '';
    this.subtitle = data.subtitle || '';
    this.description = data.description || '';
    this.fullDescription = data.fullDescription || '';
    this.professor = data.professor || '';
    this.primaryMajor = data.primaryMajor || '';
    this.crossListedMajors = data.crossListedMajors || [];
    this.tags = data.tags || [];
    this.semesterOffered = data.semesterOffered || '';
    this.credits = data.credits || '';
    this.pastStudentWork = data.pastStudentWork || '';
    this.videoLink = data.videoLink || '';
    this.link = data.link || '';
    this.image = resolveTileImage(data.image || '', this.classCode);
    this.status = data.status || '';
  }
}

Vue.directive('lazy-bg', {
  bind: function(el, binding) {
    el._lazyBgValue = binding.value;
    el._lazyBgObserver = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          el.style.backgroundImage = el._lazyBgValue;
        }
      });
    }, { rootMargin: '300px' });
    el._lazyBgObserver.observe(el);
  },
  update: function(el, binding) {
    if (binding.value !== binding.oldValue) {
      el._lazyBgValue = binding.value;
      el.style.backgroundImage = '';
      if (el._lazyBgObserver) {
        el._lazyBgObserver.unobserve(el);
        el._lazyBgObserver.observe(el);
      }
    }
  },
  unbind: function(el) {
    if (el._lazyBgObserver) {
      el._lazyBgObserver.disconnect();
    }
  }
});

var app = new Vue({
  el: '#app',
  data: {
    search: '',
    searchInputVisible: false,
    tiles: [],
    tilesFilteredByTag: [],
    majors: [],
    activeTag: '',
    selectedTile: null,
    isSignedIn: true
  },
  methods: {
    goHome: function() {
      this.selectedTile = null;
      this.removeFilters();
      window.scrollTo(0, 0);
    },
    openCourse: function(tile) {
      this.selectedTile = tile;
      window.scrollTo(0, 0);
    },
    closeCourse: function() {
      this.selectedTile = null;
      window.scrollTo(0, window.innerWidth*.3);
    },
    filterFromDetail: function(selectedTag) {
      this.selectedTile = null;
      this.filterTilesByTag(selectedTag);
    },
    filterTilesByTag: function(selectedTag) {
      this.activeTag = selectedTag;
      this.tilesFilteredByTag = this.tiles.filter(function (tile) {
        if (selectedTag) {
          if (tile.tags) {
            for (let tag of tile.tags) {
              if (tag.toLowerCase() === selectedTag.toLowerCase()) {
                return true;
              }
            }
          }
          return false;
        } else {
          return true;
        }
      });
      window.scrollTo(0, window.innerWidth*.48);
    },
    onSearchEnter: function(el) {
      window.scrollTo(0, window.innerWidth*.48);
      el.children[0].focus();
    },
    removeFilters: function() {
      this.search = '';
      this.tilesFilteredByTag = this.tiles;
      this.activeTag = '';
    },
    tileMatchesSearch: function(tile) {
      var query = this.search.toLowerCase();
      if (!query) return true;

      var searchableText = [
        tile.classCode,
        tile.title,
        tile.subtitle,
        tile.description,
        tile.fullDescription,
        tile.professor,
        tile.primaryMajor,
        tile.semesterOffered,
        tile.credits,
        tile.tags ? tile.tags.join(' ') : ''
      ].join(' ').toLowerCase();

      return searchableText.includes(query);
    }
  },
  computed: {
    filteredProjectTiles: function() {
      if (this.searchInputVisible) {
        window.scrollTo(0, window.innerWidth*.48);
      }
      return this.tilesFilteredByTag.filter(tile => tile.type === 'project' && this.tileMatchesSearch(tile));
    }
  }
});

function parseData(data) {
  let tiles = [];
  let majors = [];
  let projectsData = data['Projects'] || [];

  for (let i = 0; i < projectsData.length; i++) {
    let row = projectsData[i];
    let status = getField(row, ['Status']).trim();

    // Only show Published rows if the Status column is being used.
    // Blank status still appears so the site works while you are testing.
    if (status && status.toLowerCase() !== 'published') continue;

    let majorsFromSheet = splitTags(getField(row, ['Majors', 'Primary Major', 'Major']));
    let primaryMajor = majorsFromSheet[0] || getField(row, ['Primary Major', 'Major']);
    let crossListedMajors = uniqueList(majorsFromSheet.slice(1).concat(splitTags(getField(row, ['Cross-Listed Majors', 'Cross Listed Majors']))));
    let conceptTags = splitTags(getField(row, ['Concept Tags', 'Tags']));
    let allTags = uniqueList(majorsFromSheet.concat(crossListedMajors).concat(conceptTags));

    let tile = new Tile({
      type: 'project',
      order: getField(row, ['Order', 'Class Code']) || i,
      classCode: getField(row, ['Class Code']),
      title: getField(row, ['Class Title', 'Class title', 'Title']),
      subtitle: getField(row, ['Professor Name', 'Preferred Name']),
      description: getField(row, ['Short Blurb', 'Short blurb', 'Description']),
      fullDescription: getField(row, ['Full Description', 'Description']),
      professor: getField(row, ['Professor Name']),
      primaryMajor: primaryMajor,
      crossListedMajors: crossListedMajors,
      tags: allTags,
      semesterOffered: getField(row, ['Semester Offered']),
      credits: getField(row, ['Credits']),
      pastStudentWork: getField(row, ['Past Student Work']),
      videoLink: getField(row, ['Video Link']),
      image: getField(row, ['Tile Image', 'Tile image', 'Image Link']),
      status: status
    });

    tiles.push(tile);

    majorsFromSheet.forEach(function(majorName) {
      if (majorName && !majors.some(major => major.name.toLowerCase() === majorName.toLowerCase())) {
        majors.push({ name: majorName });
      }
    });
  }

  DEFAULT_PROGRAMS.forEach(function(programName) {
    if (!majors.some(major => major.name.toLowerCase() === programName.toLowerCase())) {
      majors.push({ name: programName });
    }
  });

  app.majors = majors;
  app.tiles = tiles;
  app.tilesFilteredByTag = tiles;
  window.scrollTo(0,0);
}

// getting data from data.json
var oReq = new XMLHttpRequest();
oReq.onload = function() {
  var response = JSON.parse(this.responseText);
  var data = new Object();

  for (var k = 0; k < response.valueRanges.length; k++) {
    var range = response.valueRanges[k];
    if (range.values && range.values.length > 0) {
      var isProjects = range.range.includes('Projects');
      // Repair blank header cells (e.g. a missing "Majors" header in column G)
      // so values are never keyed under an empty string and dropped.
      let columnNames = repairHeaders(range.values[0], isProjects);
      var sheetData = [];
      for (let i = 1; i < range.values.length; i++) {
        let rowData = new Object();
        for (let j = 0; j < range.values[i].length; j++) {
          rowData[columnNames[j]] = range.values[i][j];
        }
        sheetData.push(rowData);
      }
      if (isProjects) {
        data['Projects'] = sheetData;
      }
    }
  }

  parseData(data);
};
oReq.open('get', 'data/data.json', true);
oReq.send();
