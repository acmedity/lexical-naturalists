export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });
  eleventyConfig.addPassthroughCopy({ "../plates": "plates" });

  eleventyConfig.addWatchTarget("../entries/");
  eleventyConfig.addWatchTarget("../plates/");

  eleventyConfig.addFilter("romanNumeral", (n) => {
    const map = [
      [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
      [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
      [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
    ];
    let out = "";
    let num = Number(n);
    for (const [v, s] of map) {
      while (num >= v) { out += s; num -= v; }
    }
    return out;
  });

  eleventyConfig.addFilter("statusSlug", (status) =>
    String(status).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  );

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
    templateFormats: ["njk", "md", "html"],
  };
}
