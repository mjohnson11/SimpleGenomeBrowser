// Helper functions for displaying things in the SGB browser that are not general enough
// for the main SimpleGenomeBrowser codebase

import * as aq from 'https://cdn.jsdelivr.net/npm/arquero@8.0.3/+esm';
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import Sortable, { MultiDrag } from 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/modular/sortable.esm.js';
if (!Sortable._sgbMultiDragMounted) {
  try {
    Sortable.mount(new MultiDrag());
  } catch (e) {
    // Already mounted
  }
  Sortable._sgbMultiDragMounted = true;
}
import { reverse_complement, copy_sequence } from "./util.js";


function open_column_selector(options) {
  const column_config = options.column_config || [];
  const unused_config = options.unused_config || [];
  const title = options.title || 'Select columns';
  const onSave = options.onSave || function(){};

  // ensure only one modal exists
  d3.select('.sgb_column_selector_modal').remove();

  const modal = d3.select('body').append('div')
    .attr('class', 'sgb_column_selector_modal')
    .style('position', 'fixed')
    .style('left', '0px')
    .style('top', '0px')
    .style('width', '100%')
    .style('height', '100%')
    .style('background-color', 'rgba(0,0,0,0.4)')
    .style('display', 'flex')
    .style('align-items', 'center')
    .style('justify-content', 'center')
    .style('z-index', 10000);

  const box = modal.append('div')
    .attr('class', 'sgb_column_selector_box')
    .style('width', '720px')
    .style('height', '520px')
    .style('background-color', 'white')
    .style('border', '1px solid #888')
    .style('border-radius', '6px')
    .style('padding', '12px')
    .style('box-sizing', 'border-box')
    .style('display', 'flex')
    .style('flex-direction', 'column');

  box.append('h3').text(title).style('margin', '4px 0 8px 0');

  const content = box.append('div')
    .style('flex', '1')
    .style('display', 'flex')
    .style('gap', '8px');

  // left: available columns
  const left = content.append('div')
    .style('flex', '1')
    .style('border', '1px solid #ddd')
    .style('height', '450px')
    .style('overflow', 'scroll')
    .style('padding', '6px')
    .style('min-width', '240px');

  left.append('div').text('Available columns').style('font-weight', '600').style('margin-bottom', '6px');

  // right: current columns
  const right = content.append('div')
    .style('flex', '1')
    .style('border', '1px solid #ddd')
    .style('height', '450px')
    .style('overflow', 'scroll')
    .style('padding', '6px')
    .style('min-width', '240px');

  right.append('div').text('Current columns').style('font-weight', '600').style('margin-bottom', '6px');

  // TODO BUG here the search repopulates these incorrectly
  left.append('input')
    .attr('type', 'text')
    .attr('placeholder', 'Search available...')
    .style('width', '100%') // Use 100% width of parent
    .style('padding', '4px')
    .style('margin-bottom', '6px')
    .style('box-sizing', 'border-box') // Ensures padding doesn't break layout
    .on('input', function(event) {
        const searchText = event.target.value.toLowerCase();
        
        // Select items *only* in the available list
        availList.selectAll('.sgb_item')
          .classed('sgb_item_filtered_out', d => {
            const nameMatch = d.name.toLowerCase().includes(searchText);
            const subtitleMatch = disp(d).toLowerCase().includes(searchText);
            // Return null to show (removes inline style), 'none' to hide.
            return !(nameMatch || subtitleMatch);
          });
    });

  right.append('input')
    .attr('type', 'text')
    .attr('placeholder', 'Search current...')
    .style('width', '100%')
    .style('padding', '4px')
    .style('margin-bottom', '6px')
    .style('box-sizing', 'border-box')
    .on('input', function(event) {
        const searchText = event.target.value.toLowerCase();
        // Select items *only* in the current list
        currList.selectAll('.sgb_item')
          .classed('sgb_item_filtered_out', d => {
            const nameMatch = d.name.toLowerCase().includes(searchText);
            return !(nameMatch);
          });
    });


  const availList = left.append('div')
    .attr('class', 'sgb_avail_list')
    .style('min-height', '400px') // makes it nicer to drag into an empty list
    .style('overflow-y', 'auto'); 

  //const currList = right.append('div').attr('class', 'sgb_curr_list');

  const currList = right.append('div')
    .attr('class', 'sgb_curr_list')
    .style('min-height', '400px')
    .style('overflow-y', 'auto'); 

  // helper to get display subtitle
  const disp = (col) => {
    if (col.agg_columns) {
      return col.agg_columns.map(c => c.name+', '+c.column).join(' ; ');
    } else {
      return col.column;
    }
  };

  availList.selectAll('.sgb_item')
    .data(unused_config)
    .join('div')
    .attr('class', 'sgb_item')
    .style('padding', '6px')
    .style('border-bottom', '1px solid #f0f0f0')
    .style('cursor', 'pointer')
    .style('user-select', 'none')
    .html(d => `<div style="font-size:12px">${d.name}<div style="font-size:10px;color:#666">${disp(d)}</div></div>`);

  currList.selectAll('.sgb_item')
    .data(column_config)
    .join('div')
    .attr('class', 'sgb_item')
    .style('padding', '6px')
    .style('border-bottom', '1px solid #f0f0f0')
    .style('cursor', 'pointer')
    .style('user-select', 'none')
    .html(d => `<div style="font-size:12px">${d.name}<div style="font-size:10px;color:#666">${disp(d)}</div></div>`);


  new Sortable(availList.node(), {
    multiDrag: true,
    group: 'shared', // set both lists to same group
    animation: 150,
    selectedClass: 'sgb_list_selected',
    avoidImplicitDeselect: false,
    multiDragKey: 'Meta',
    filter: '.sgb_item_filtered_out',
    emptyInsertThreshold: 15,
    dragoverBubble: true
  })
  
  new Sortable(currList.node(), {
    multiDrag: true,  
    group: 'shared',
    animation: 150,
    selectedClass: 'sgb_list_selected',
    avoidImplicitDeselect: false,
    multiDragKey: 'Meta',
    filter: '.sgb_item_filtered_out',
    emptyInsertThreshold: 15,
    dragoverBubble: true
  });

  // Function to close the modal
  const closeModal = () => {
    d3.select('.sgb_column_selector_modal').remove();
  };

  const update_and_exit = () => {
    closeModal();
    onSave(currList.selectAll('.sgb_item').data(), availList.selectAll('.sgb_item').data());   
  }

  const footer = box.append('div')
    .style('display', 'flex')
    .style('justify-content', 'flex-end')
    .style('gap', '8px')
    .style('padding-top', '12px');

  // Cancel button
  footer.append('button')
    .text('Cancel')
    .style('padding', '8px 16px')
    .style('border', '1px solid #ccc')
    .style('background-color', '#f0f0f0')
    .style('cursor', 'pointer')
    .on('click', closeModal);

  // Save button
  footer.append('button')
    .text('Save')
    .style('padding', '8px 16px')
    .style('border', 'none')
    .style('color', 'white')
    .style('background-color', '#007bff')
    .style('cursor', 'pointer')
    .on('click', update_and_exit)
}

function nice_logcount_scale(axis, scale, n_ticklabels=5) {
  // the input should be an axis with a log scale already attached
  // with the domain already set
  // this will take the default d3 ticks and amend them, and then 
  // pick which ones to actually display
  // this mutates the axis and returns an array of numbers for the displayed ticks
  let og_ticks = scale.ticks();
  const top_tick = og_ticks[og_ticks.length-1];
  let tick_labels = [0]
  if (top_tick > 0) {
    let step = Math.log10(top_tick) / n_ticklabels;
    for (let i=0; i<n_ticklabels; i++) {
      const spot = Math.floor(step*i);
      if (step*i > spot+0.5) {
        tick_labels.push(Math.pow(10, spot+1));
      } else {
        tick_labels.push(Math.pow(10, spot));
      }
    }

  }
  // unique & sorted ascending
  tick_labels = Array.from(new Set(tick_labels)).sort((a, b) => a - b);
  if ((top_tick > 0) && (top_tick/2 > tick_labels[tick_labels.length-1])) tick_labels.push(top_tick); // don't include if too close
  axis.tickValues(Array.from(new Set(tick_labels).union(new Set(og_ticks))).sort((a, b) => a - b));
  axis.tickFormat((t) => (tick_labels.indexOf(t)>-1) ? t : '')
  return tick_labels
}

function data_shaper(aq_df, column_config, icols, suffixes=['']) {
  // column_config is an array of columns that will be displayed, with entries like:
  // { 
  //    name: ...,
  //    column: ...,
  //    agg_columns: [...],
  //    agg_op: (mean|median),
  // }

  // roundtrip to objects is probably a bad idea, but here we are
  let new_data = [];
  let use_cols = [];
  let new_cols = [];
  for (let c of column_config) {
    if (c.agg_columns) {
      for (let suffix of suffixes) {
        let agg_col_names = c.agg_columns.map(col => col.column+suffix)
        new_cols.push(c.name+suffix)
        use_cols = use_cols.concat(agg_col_names)
      }
    } else {
      use_cols.push(c.column)
    }
  }
  if (new_cols.length > 0) {
    for (let row of aq_df.select(use_cols).objects()) {
      let new_row = {};
      for (let c of column_config) {
        if (c.agg_columns) {
          for (let suffix of suffixes) {
            let agg_cols = c.agg_columns.map(col => row[col.column+suffix])
            let vals = agg_cols.filter(v => v != null && !Number.isNaN(v));
            if (vals.length == 0) {
              new_row[c.name+suffix] = null;
            } else if (c.agg_op == 'mean') {
              new_row[c.name+suffix] = d3.mean(vals);
            } else if (c.agg_op == 'median') {
              new_row[c.name+suffix] = d3.median(vals);
            }
          }
        }
      }
      new_data.push(new_row);
    }
    console.log('new_data sample:', new_data.slice(0,5), aq_df.select(use_cols).objects().slice(0,5));
    return aq_df.select(icols.concat(use_cols)).assign(aq.from(new_data));
  } else {
    return aq_df.select(icols.concat(use_cols))
  }
  
  /* 
  here is an old arquero version, pretty messy  "escape" stuff, 
  not sure if it's worth it, so I am going to do an objects() approach
  which will be slow, but we can tolerate a little loading here
  for (let c of column_config) {
    if (c.agg_columns) {
      extra_cols = extra_cols.concat(c.agg_columns);
      if (c.agg_op == 'mean') {
        aq_df = aq_df
          .derive({ Atmp: aq.escape(
            function(d) {
              let use_cols = c.agg_columns.filter(tmp_col => !Number.isNaN(d[tmp_col]));
              return d3.mean(use_cols.map(tmp_col => d[tmp_col]));
            }
          )}).rename({ Atmp: c.name });
      } else if (c.agg_op == 'median') {
        aq_df = aq_df
          .derive({ Atmp: aq.escape(
            function(d) {
              let use_cols = c.agg_columns.filter(tmp_col => !Number.isNaN(d[tmp_col]));
              return d3.median(use_cols.map(tmp_col => d[tmp_col]));
            }
          )}).rename({ Atmp: c.name });
      }
    }
  }
  console.log(aq_df.select(icols.concat(column_config.map(c => c.name)).concat(extra_cols)).objects().slice(0,5));
  */
}

function sidebar_morgan_info(sgb, gene_object, orgId = null) {
  if (gene_object) {
    const { locusId, name, desc, begin, end, strand, scaffoldId, pseudo } = gene_object;
    const effective_orgId = orgId || sgb.config?.orgId || sgb.orgId || sgb.title || null;

    sgb.sidebar_div.append('p')
        .attr('class', 'sidebar_title')
        .style('margin-bottom', '5px')
        .html(`<strong>${name}</strong>`)

    sgb.sidebar_div.append('hr')
      .style('border-top', '6px solid #333')

    const sidebar_info_rows = [
      ['Locus ID:', locusId],
      ['Description:', desc],
      ['Contig:', scaffoldId],
      ['Start:', begin],
      ['End:', end],
      ['Strand:', strand]
    ]
    if (pseudo) sidebar_info_rows.push(['(Pseudogene)', '']);

    sgb.sidebar_div.selectAll('.sidebar_info_row')
      .data(sidebar_info_rows)
      .enter()
      .append('p')
        .attr('class', 'sidebar_info_row')
        .html((d) =>  `<strong>${d[0]}</strong> ${d[1]}`)
  
    sgb.sidebar_div.append('p').append('button')
      .html('Copy DNA Sequence')
      .on('click', function() {
        const seq = sgb.get_sequence(begin, end, scaffoldId, String(strand) === '-' ? '-' : '+');
        copy_sequence(seq, this);
      })
    
    if (sgb.aa_seqs && Object.keys(sgb.aa_seqs).length > 0) {
      if (locusId in sgb.aa_seqs) {
        const aa_seq = sgb.aa_seqs[locusId];
        sgb.sidebar_div.append('p').append('button')
          .html('Copy AA Sequence')
          .on('click', function() {
            copy_sequence(aa_seq, this);
          })
        sgb.sidebar_div.append('p').append('a')
          .attr('href', `https://fast.genomics.lbl.gov/cgi/findHomologs.cgi?seqDesc=${locusId}&seq=${aa_seq}`)
          .attr('target', '_blank')
          .html('Find homologs with fast.genomics')
      } else {
        sgb.sidebar_div.append('p').html('No AA sequence available');
      }
    }
    if (effective_orgId) {
      sgb.sidebar_div.append('p').append('a')
        .attr('href', `https://fit.genomics.lbl.gov/cgi-bin/singleFit.cgi?orgId=${effective_orgId}&locusId=${locusId}&showAll=1`)
        .attr('target', '_blank')
        .html('Fitness Data')
      sgb.sidebar_div.append('p').append('a')
        .attr('href', `https://fit.genomics.lbl.gov/cgi-bin/cofit.cgi?orgId=${effective_orgId}&locusId=${locusId}`)
        .attr('target', '_blank')
        .html('Cofitness')
      sgb.sidebar_div.append('p').append('a')
        .attr('href', `https://fit.genomics.lbl.gov/cgi-bin/domains.cgi?orgId=${effective_orgId}&locusId=${locusId}`)
        .attr('target', '_blank')
        .html('Protein Info')
    }
  }
}

function make_heatmap_summary_sidebar(track, col, tooltip_func = null) {
  const self = track;

  function show_panel(panel_name) {
    const p = sidebar_panels[panel_name];
    self.active_sidebar_panel = panel_name;
    d3.select(p.button.node().parentNode).selectAll('button').classed('active', false);
    d3.select(p.button.node()).classed('active', true);
    self.sgb.sidebar_div.selectAll('.panel_content').style('display', 'none');
    self.sgb.sidebar_div.selectAll(`.${p.class}`).style('display', 'block');
  }

  const sorted = self.data.data
    .params({ c: col.column })
    .orderby(aq.desc((d, $) => d[$.c]));

  const topGenes = sorted.slice(0, 10).objects().map(row => ({ gene: row, score: row[col.column] }));
  const bottomGenes = sorted.slice(-10).objects().map(row => ({ gene: row, score: row[col.column] }));

  self.sgb.sidebar_div.selectAll('*').remove();

  // Add tabs
  const tabs = self.sgb.sidebar_div.append('div').attr('class', 'tabs');
  const sidebar_panels = {
    gene_hits: { class: 'gene_pm_content', title: 'Top Gene Hits' },
    gene_compare: { class: 'gene_compare_content', title: 'Scatterplots' }
  };
  for (const sp of Object.keys(sidebar_panels)) {
    sidebar_panels[sp].button = tabs.append('button')
      .text(sidebar_panels[sp].title)
      .on('click', function() {
        show_panel(sp, this);
      });
  }

  // Making plus/minus gene display
  const pm_contentDiv = self.sgb.sidebar_div.append('div')
    .attr('class', 'panel_content gene_pm_content');

  pm_contentDiv.append('div')
    .attr('class', 'gene-table')
    .html(`<h3 style="font-size: 14px; margin: 8px 0;">${col.name}</h3>`);

  const table = pm_contentDiv.select('.gene-table').append('table')
    .style('width', '350px')
    .style('border-collapse', 'collapse')
    .style('border', '1px solid #ddd')
    .style('table-layout', 'fixed');

  const thead = table.append('thead');
  const headerRow = thead.append('tr')
    .style('background-color', '#f5f5f5')
    .style('border-bottom', '2px solid #ddd');

  headerRow.selectAll('th')
    .data(['Name', 'Description', 'Score'])
    .enter()
    .append('th')
    .style('padding', '4px')
    .style('border-right', (d, i) => i < 2 ? '1px solid #ddd' : null)
    .style('font-size', '12px')
    .style('width', (d) => {
      if (d === 'Name') return '30%';
      if (d === 'Description') return '50%';
      return '20%';
    })
    .text(d => d);

  const tbody = table.append('tbody');

  const createRows = (data, isTop) => {
    if (data.length === 0) return;

    tbody.append('tr')
      .style('background-color', '#f5f5f5')
      .append('td')
      .attr('colspan', 3)
      .style('padding', '4px')
      .style('font-size', '12px')
      .style('border-bottom', '1px solid #ddd')
      .html(`<strong>${isTop ? 'Top 10 Genes' : 'Bottom 10 Genes'}</strong>`);

    const rows = tbody.selectAll(`.gene-row-${isTop ? 'top' : 'bottom'}`)
      .data(data)
      .enter()
      .append('tr')
      .attr('class', `gene-row-${isTop ? 'top' : 'bottom'}`)
      .style('cursor', 'pointer')
      .style('border-bottom', '1px solid #ddd')
      .attr('data-locus-id', d => d.gene[self.id_col])
      .on('click', function(e, d) {
        self.sgb.display_feature(d.gene[self.contig_col], d.gene[self.start_col], d.gene[self.end_col]);
      });

    rows.append('td')
      .style('padding', '4px')
      .style('border-right', '1px solid #ddd')
      .style('font-size', '12px')
      .style('width', '30%')
      .html(d => (d.gene.name == 'NA') ? d.gene[self.id_col] : d.gene.name || d.gene[self.id_col]);

    rows.append('td')
      .style('padding', '4px')
      .style('border-right', '1px solid #ddd')
      .style('font-size', '12px')
      .style('width', '50%')
      .text(function(d) {
        if (d.gene.desc) {
          return `${d.gene.desc.substring(0, 50)}${d.gene.desc.length > 50 ? '...' : ''}`;
        }
        return '';
      });

    rows.append('td')
      .style('padding', '4px')
      .style('font-size', '12px')
      .style('width', '20%')
      .style('background-color', d => d3.scaleDiverging()
        .domain([-4, 0, 4])
        .range(["#2d03fc", "#CCCCCC", "#fcdb03"])(d.score))
      .text(d => d.score !== null && d.score !== undefined ? Number(d.score).toFixed(2) : '');
  };

  createRows(topGenes, true);
  createRows(bottomGenes.reverse(), false);

  const compare_contentDiv = self.sgb.sidebar_div.append('div')
    .attr('class', 'panel_content gene_compare_content')
    .style('display', 'none');

  const select = compare_contentDiv.append('select')
    .style('margin', '10px');

  let yAxisColumn = self.include_halfs ? col.column : self.column_config[0].column;
  select.selectAll('option')
    .data(self.column_config)
    .enter()
    .append('option')
    .text(d => d.name)
    .attr('value', d => d.column);

  select.property('value', yAxisColumn);

  select.on('change', function() {
    yAxisColumn = d3.select(this).property('value');
    updateScatterplot();
  });

  const svgWidth = 340;
  const svgHeight = 250;
  const margin = { top: 20, right: 20, bottom: 30, left: 50 };
  const width = svgWidth - margin.left - margin.right;
  const height = svgHeight - margin.top - margin.bottom;

  const svg = compare_contentDiv.append('svg')
    .attr('width', svgWidth)
    .attr('height', svgHeight)
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  let xScale, yScale;

  function updateScatterplot() {
    const half_half_plot = ((yAxisColumn == col.column) && self.include_halfs);
    const xcol = half_half_plot ? col.column + '_half1' : col.column;
    const ycol = half_half_plot ? col.column + '_half2' : yAxisColumn;

    const plotData = self.data.data
      .select([xcol, ycol, self.contig_col, self.start_col, self.end_col, self.id_col, 'name', 'desc'])
      .rename({ [xcol]: 'x', [ycol]: 'y' })
      .objects();

    xScale = d3.scaleLinear()
      .domain([d3.min(plotData, d => d.x), d3.max(plotData, d => d.x)])
      .range([0, width]);

    yScale = d3.scaleLinear()
      .domain([d3.min(plotData, d => d.y), d3.max(plotData, d => d.y)])
      .range([height, 0]);

    svg.selectAll('*').remove();

    svg.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(xScale));

    svg.append('g')
      .call(d3.axisLeft(yScale));

    svg.selectAll('.dot')
      .data(plotData)
      .enter().append('circle')
      .attr('class', 'dot')
      .attr('cx', d => xScale(d.x))
      .attr('cy', d => yScale(d.y))
      .attr('r', 3)
      .attr('fill', '#333')
      .on('click', (event, d) => {
        self.sgb.display_feature(d[self.contig_col], d[self.start_col], d[self.end_col]);
      })
      .on('mouseover', function(event, d) {
        d3.select(this)
          .attr('fill', 'red')
          .raise();
        if (tooltip_func) tooltip_func(self.sgb, event, d);
      })
      .on('mouseout', () => {
        svg.selectAll('.dot').attr('fill', '#333');
        self.sgb.hide_tooltip();
      });

    svg.append("text")
      .attr("x", width / 2)
      .attr("y", height + margin.bottom)
      .style("text-anchor", "middle")
      .style("font-size", "14px")
      .text(half_half_plot ? col.name + " (half1)" : col.name);

    svg.append("text")
      .attr("transform", "rotate(-90)")
      .attr("y", 0 - margin.left)
      .attr("x", 0 - (height / 2))
      .attr("dy", "1em")
      .style("text-anchor", "middle")
      .style("font-size", "14px")
      .text(half_half_plot ? col.name + " (half2)" : yAxisColumn);
  }
  updateScatterplot();

  self.sgb.sidebar_content.node().scrollTop = 0;
  self.sgb.show_sidebar(null, 380);
  show_panel(self.active_sidebar_panel);
}

export { open_column_selector, data_shaper, sidebar_morgan_info, nice_logcount_scale, make_heatmap_summary_sidebar };