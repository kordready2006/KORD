# KORD data format

One JSON file per Ohio region in `data/regions/<region>.json`. Every fact must come from a page that was actually read, and carry the URL it came from.

```json
{
  "region": "Southeast Ohio",
  "researchedOn": "2026-11-25",
  "towns": [
    {
      "id": "athens",                      // lowercase slug, unique statewide
      "name": "Athens",
      "colleges": [
        { "name": "Ohio University", "type": "Public university", "url": "https://www.ohio.edu" }
      ],
      "spots": [
        {
          "name": "Example Boba",
          "category": "Boba & Tea",        // one of the categories below
          "local": true,                   // true = local/regional spot, false = national chain
          "signature": true,               // true only for the town's iconic must-visit places
          "address": "1 W Union St, Athens, OH 45701",
          "website": "https://exampleboba.com",   // the business's own site (or its official social page if it has no site)
          "blurb": "One sentence on what it is known for.",
          "price": "$",                    // $, $$ or $$$
          "sourceUrl": "https://...",      // page that confirms the spot exists at this location
          "deals": [
            {
              "days": ["Tue"],             // any of Mon Tue Wed Thu Fri Sat Sun; all seven for an everyday deal
              "title": "$2 Taco Tuesday",
              "details": "Short factual description, including hours or conditions.",
              "price": "$2",               // headline price or discount if stated, else ""
              "studentOnly": false,        // true if it needs a student ID
              "sourceUrl": "https://...",  // page where this exact deal is stated
              "sourceDate": "2026-09"      // date of the source if known (YYYY or YYYY-MM), else ""
            }
          ]
        }
      ]
    }
  ]
}
```

Categories: `Pizza`, `Burgers`, `Mexican`, `Sandwiches & Subs`, `Wings & Chicken`, `Asian`, `Boba & Tea`, `Coffee & Bakery`, `Breakfast & Brunch`, `Bar & Grill`, `Dessert & Ice Cream`, `BBQ`, `Mediterranean`, `Healthy & Bowls`, `Fast Food`, `Other`.

Rules:

- Never invent a deal, price, address or URL. A spot with no confirmed deal gets `"deals": []`.
- Only recurring deals (weekly specials, daily specials, happy hours, standing student discounts). No one-off promotions.
- No alcohol-only deals; a happy hour counts only for its food specials.
