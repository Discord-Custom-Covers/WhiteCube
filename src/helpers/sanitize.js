// This code is fully home-grown
const map = ["\\", "\\*", "/*", '"', "'", "bypass"];

function sanitize(string) {
  var newstring = string;

  for (pattern of map) {
    newstring = newstring.replaceAll(pattern, "");
    if (string.includes(pattern)) {
      newstring = sanitize(newstring);
    }
  }
  return newstring;
}

exports.sanitize = sanitize;
