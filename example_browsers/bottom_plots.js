import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

const base_color = '#333';
const hover_color = 'red';

const corr_domain = [-6, 6];

const corr_x1 = d3.scaleLinear().range([60, 260]).domain(corr_domain).clamp(true);

const corr_x2 = d3.scaleLinear().range([400,600]).domain(corr_domain).clamp(true);

const corr_y = d3.scaleLinear().range([240,50]).domain(corr_domain).clamp(true);

const counts_x = d3.scaleBand().range([650, 780]).domain(['Time 0', 'Sample']).padding(0.5);

const counts_y = d3.scaleLinear().range([240,50]).domain([-6, 0]);

function standard_axes(svg_obj, xscale, yscale) {
  const x_ax = d3.axisBottom(xscale).ticks(5);
  const y_ax = d3.axisLeft(yscale);
  if (yscale.domain().length == 2) y_ax.ticks(5);

  svg_obj.append('g')
    .attr('class', 'axis')
    .attr('transform', 'translate(' + xscale.range()[0] + ', 0)')
    .call(y_ax);
  svg_obj.append('g')
    .attr('class', 'axis')
    .attr('transform', 'translate(0,' + yscale.range()[0] + ')')
    .call(x_ax);
}


function one_corr_graph(svg_obj, xcol, ycol, xscale, yscale) {

  svg_obj.selectAll('.corr_group').append('line')
    .attr('class', 'corr_error')
    .attr('x1', (d) => xscale(d[xcol]))
    .attr('x2', (d) => xscale(d[xcol]))
    .attr('y1', (d) => yscale(d[ycol.replace('_s','_low_conf')]))
    .attr('y2', (d) => yscale(d[ycol.replace('_s','_high_conf')]))
    .style('stroke', 'black')
    .style('stroke-width', '0.5')
    .style('display', 'none')

  svg_obj.selectAll('.corr_group').append('line')
    .attr('class', 'corr_error')
    .attr('x1', (d) => xscale(d[xcol.replace('_s','_low_conf')]))
    .attr('x2', (d) => xscale(d[xcol.replace('_s','_high_conf')]))
    .attr('y1', (d) => yscale(d[ycol]))
    .attr('y2', (d) => yscale(d[ycol]))
    .style('stroke', 'black')
    .style('stroke-width', '0.5')
    .style('display', 'none')

  svg_obj.selectAll('.corr_group').append('circle')
    .attr('class', 'corr_point')
    .attr('r', 2)
    .attr('fill', base_color)
    .attr('cx', (d) => xscale(d[xcol]))
    .attr('cy', (d) => yscale(d[ycol]));
    
}

function hover_on_group(group) {
  group.raise().selectAll('.corr_point')
  .attr('fill', hover_color)
  .attr('r', 4);
  group.selectAll('.corr_error')
    .style('display', 'block')
}

function click_on_group(group) {
  group.raise().selectAll('.corr_point')
  .attr('fill', 'blue')
  .attr('r', 4);
  group.selectAll('.corr_error')
    .style('display', 'block')
}

function end_hover_on_group(group) {
  group.selectAll('.corr_point')
    .attr('fill', base_color)
    .attr('r', 2);
  group.selectAll('.corr_error')
    .style('display', 'none')
}

function draw_count_graph(svg, row, condition) {
  svg.select('#count_graph').remove()
  const cg = svg.append('g').attr('id', 'count_graph')
  cg.append('text')
    .attr('class', 'axis_label')
    .attr('text-anchor', 'middle')
    .attr('x', (counts_x.range()[1]+counts_x.range()[0])/2)
    .attr('y', counts_y.range()[1]-30)
    .text(condition)
    .attr('fill', base_color);

  let count_dat = []
  for (let r of row[condition.split('_')[0]+'_count_info'].split(';')) {
    count_dat.push({'Sample': 'Time 0', 'count': r.split(':')[0], 'Log10Freq': parseFloat(r.split(':')[1])})
  }
  for (let r of row[condition+'_count_info'].split(';')) {
    count_dat.push({'Sample': 'Sample', 'count': r.split(':')[0], 'Log10Freq': parseFloat(r.split(':')[1])})
  }

  cg.selectAll('.count_mark')
    .data(count_dat)
    .enter()
    .append('g')
      .attr('class', 'count_mark')
      .on('mouseover', function() {
        d3.select(this).selectAll('text').style('visibility', 'visible');
      })
      .on('mouseout', function() {
        d3.select(this).selectAll('text').style('visibility', 'hidden');
      })

  console.log(count_dat);
  console.log(count_dat.map((d) => counts_y(d.Log10Freq)))
  console.log(count_dat.map((d) => counts_x(d.Sample)))
  svg.selectAll('.count_mark').append('circle')
    .attr('cx', (d) => counts_x(d.Sample))
    .attr('cy', (d) => counts_y(d.Log10Freq))
    .attr('r', 3)
    .attr('fill', '#333')
    .attr('opacity', 0.7)
    .on('mouseover', function() {
      d3.select(this).attr('opacity', 0.9)
    })
    .on('mouseout', function() {
      d3.select(this).attr('opacity', 0.7)
    })

  svg.selectAll('.count_mark').append('text')
    .attr('x', (d) => counts_x(d.Sample)+5)
    .attr('y', (d) => counts_y(d.Log10Freq))
    .html((d) => d.count)
    .style('visibility', 'hidden')

}

function set_axis_label(svg_obj, xscale, yscale, text, which_axis) {
  if (which_axis == 'x') {
    const xmid = (xscale.range()[0]+xscale.range()[1])/2;
    svg_obj.append('text')
      .attr('class', 'axis_label')
      .attr('text-anchor', 'middle')
      .attr('x', xmid)
      .attr('y', yscale.range()[0]+40)
      .text(text)
      .attr('fill', base_color);
  } else {
    svg_obj.append('text')
      .attr('class', 'axis_label')
      .attr('text-anchor', 'middle')
      .attr('x', xscale.range()[0])
      .attr('y', yscale.range()[1]-10)
      .text(text)
      .attr('fill', base_color);
  }
}


function make_graphs(div, data, my_browser, x1, y1) {

  let x2 = y1 + '_1';
  let y2 = y1 + '_2';

  const svg_obj = div.append('svg')
    .attr('class', 'WOW_svg')
    .style('position', 'absolute')
    .style('left', 0)
    .style('top', 600)
    .attr('width', 800)
    .attr('height', 300);

  let group_map = {};
  svg_obj.selectAll('.corr_group')
    .data(data)
    .enter()
    .append('g')
      .each(function(d, i) {
        group_map[i] = d3.select(this);
      })
      .attr('class', 'corr_group')
      .on('mouseover', function(e, d) {
        hover_on_group(d3.select(this));
        my_browser.show_tooltip(e.x, e.y, [d.locus_tag, d.gene, d.product].join('\n'))
      })
      .on('mouseout', function() {
        end_hover_on_group(d3.select(this));
        my_browser.hide_tooltip();
      })
      .on('click', function(e, d) {
        const size = d.end-d.start
        my_browser.display_region({'contig': d.contig, 'domain': [d.start-size/2, d.end+size/2]});
      });

  my_browser.tracks[1].callback = function(action, data_index, condition) {
    if (action == 'mouseout') {
      end_hover_on_group(group_map[data_index]);
      //svg_obj.select('#count_graph').remove();
    } else if (action == 'click') {
      click_on_group(group_map[data_index]);
      draw_count_graph(svg_obj, data[data_index], condition.split('_s')[0]);
    } else {
      hover_on_group(group_map[data_index]);
      draw_count_graph(svg_obj, data[data_index], condition.split('_s')[0]);
    } 
  }

  standard_axes(svg_obj, corr_x1, corr_y);
  standard_axes(svg_obj, corr_x2, corr_y);
  
  one_corr_graph(svg_obj, x1, y1, corr_x1, corr_y);
  one_corr_graph(svg_obj, x2, y2, corr_x2, corr_y);

  standard_axes(svg_obj, counts_x, counts_y)

  set_axis_label(svg_obj, corr_x1, corr_y, x1, 'x');
  set_axis_label(svg_obj, corr_x1, corr_y, y1, 'y');
  set_axis_label(svg_obj, corr_x2, corr_y, x2.replace('_s_1', ' first half'), 'x');
  set_axis_label(svg_obj, corr_x2, corr_y, y2.replace('_s_2', ' second half'), 'y');


  function new_axis_label(col) {
    x1 = y1;
    y1 = col;
    x2 = y1 + '_1';
    y2 = y1 + '_2';
    d3.selectAll('.corr_error').remove();
    d3.selectAll('.corr_point').remove();
    d3.selectAll('.axis_label').remove();
    one_corr_graph(svg_obj, x1, y1, corr_x1, corr_y);
    one_corr_graph(svg_obj, x2, y2, corr_x2, corr_y);
    set_axis_label(svg_obj, corr_x1, corr_y, x1, 'x');
    set_axis_label(svg_obj, corr_x1, corr_y, y1, 'y');
    set_axis_label(svg_obj, corr_x2, corr_y, x2.replace('_s_1', ' first half'), 'x');
    set_axis_label(svg_obj, corr_x2, corr_y, y2.replace('_s_2', ' second half'), 'y');
  }

  my_browser.tracks[1].register_callback_on_row_name_click(new_axis_label);

}

export { make_graphs }