import * as aq from 'https://cdn.jsdelivr.net/npm/arquero@7.2.0/dist/arquero.min.js/+esm';

async function fetch_server_data(fetch_path, json_object) {
  // Retrieves data from a parquet file on the server
  const response = await fetch(fetch_path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(json_object),
  });
  
  if (!response.ok) {
    try {
      const errorData = await response.json();
      console.error("Error fetching data:", errorData.error || response.statusText);
    } catch (e) {
      console.error("Error fetching data:", response.statusText);
    }
    return;
  }
  
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const table = aq.fromArrow(bytes);
  const data = table.objects();
  if ('data_log_message' in Object.keys(json_object)) {
    console.log(json_object.data_log_message, data);
  }
  
  return data;
} 

function parse_fasta(data) {
  let seq_dict = {};
  let currentSeq = "";
  let currentSeqName = "";
  data.split("\n").forEach(line => {
    if (line.startsWith(">")) {
      if (currentSeqName) {
        seq_dict[currentSeqName] = currentSeq;
      }
      currentSeqName = line.slice(1).split(' ')[0];
      currentSeq = "";
    } else {
      currentSeq += line.trim();
    }
  });
  if (currentSeqName) {
    seq_dict[currentSeqName] = currentSeq;
  }
  return seq_dict;
}

function fit_text(string, fontsize, max_width, shortened=false) {
  if ((measureText(string, fontsize) > max_width) & (string.length > 1)) {
    return fit_text(string.slice(0, -1), fontsize, max_width, true) + (shortened ? '' : '...');
  } else {
    return string;
  }
}

// https://gist.github.com/tophtucker/62f93a4658387bb61e4510c37e2e97cf
function measure_text(string, fontSize = 10) {
  if (!string) return '';
  const widths = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.2796875,0.2765625,0.3546875,0.5546875,0.5546875,0.8890625,0.665625,0.190625,0.3328125,0.3328125,0.3890625,0.5828125,0.2765625,0.3328125,0.2765625,0.3015625,0.5546875,0.5546875,0.5546875,0.5546875,0.5546875,0.5546875,0.5546875,0.5546875,0.5546875,0.5546875,0.2765625,0.2765625,0.584375,0.5828125,0.584375,0.5546875,1.0140625,0.665625,0.665625,0.721875,0.721875,0.665625,0.609375,0.7765625,0.721875,0.2765625,0.5,0.665625,0.5546875,0.8328125,0.721875,0.7765625,0.665625,0.7765625,0.721875,0.665625,0.609375,0.721875,0.665625,0.94375,0.665625,0.665625,0.609375,0.2765625,0.3546875,0.2765625,0.4765625,0.5546875,0.3328125,0.5546875,0.5546875,0.5,0.5546875,0.5546875,0.2765625,0.5546875,0.5546875,0.221875,0.240625,0.5,0.221875,0.8328125,0.5546875,0.5546875,0.5546875,0.5546875,0.3328125,0.5,0.2765625,0.5546875,0.5,0.721875,0.5,0.5,0.5,0.3546875,0.259375,0.353125,0.5890625]
  const avg = 0.5279276315789471
  return string
    .split('')
    .map(c => c.charCodeAt(0) < widths.length ? widths[c.charCodeAt(0)] : avg)
    .reduce((cur, acc) => acc + cur) * fontSize
}

function copy_sequence(sequence, button, reverse_comp=false) {
  const seq = reverse_comp ? reverse_complement(sequence) : sequence;
  navigator.clipboard.writeText(seq);
  const original_button_text = button.innerHTML;
  button.innerHTML = 'Copied!'
  setTimeout(() => {
    button.innerHTML = original_button_text;
  }, 1000);
}

function reverse_complement(string) {
  const complement = {
    'A': 'T',
    'T': 'A',
    'C': 'G',
    'G': 'C',
    'a': 't',
    't': 'a',
    'c': 'g',
    'g': 'c',
    'N': 'N',
    'n': 'n',
  };
  let rev_comp = '';
  for (let i = string.length - 1; i >= 0; i--) {
    const base = string[i];
    rev_comp += complement[base] || base;
  }
  return rev_comp;
}

export { fetch_server_data, parse_fasta, fit_text, measure_text, reverse_complement, copy_sequence };