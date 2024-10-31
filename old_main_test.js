

function try_it() {
  const b_div = d3.select('#browser_div');
  const my_browser = new sgb.SimpleGenomeBrowser('./example_data/HP22.fna', true, 1000, 900, b_div, 'contig_1', [1, 10000]);
  my_browser.loadingPromise.then(sgb_instance => {
    sgb_instance.tracks.push(new sgb.gffTrack(sgb_instance, 50, 50, './example_data/HP22.gff', 'CDS'));
    sgb_instance.tracks.push(new sgb.myTnseqTrack(sgb_instance, 500, 100, './example_data/HP22_tnseq_data.tsv', tnseq_cols, tnseq_cols.map((c) => c.split('_s')[0]), 'contig'));
    sgb_instance.tracks[1].loadingPromise.then(tnseq_track => {
      make_graphs(my_browser.outer_div, tnseq_track.data, my_browser);
    })
  });
  
}


document.addEventListener('DOMContentLoaded', () => {
  // Your code to run after the DOM is ready goes here!
  console.log("DOM is fully loaded!");
  try_it();
  // ... your module initialization, D3 code, etc. ... 
});