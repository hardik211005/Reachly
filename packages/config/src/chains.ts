/**
 * Well-known multi-outlet chains and franchises (mostly India), used to flag leads that public map
 * data doesn't tag with a brand. Kept to brands that are unambiguously chains; anything smaller is
 * caught by website evidence ("franchise", "our outlets") or by a workspace marking it once.
 * Names are matched after normalisation (lower case, punctuation and branch suffixes removed).
 */
export const KNOWN_CHAINS: readonly string[] = [
  // Coffee, tea & cafés
  "Cafe Coffee Day", "CCD", "Barista", "Costa Coffee", "Costa", "Starbucks", "Tata Starbucks", "Third Wave Coffee", "Third Wave Coffee Roasters",
  "Blue Tokai", "Blue Tokai Coffee Roasters", "Chaayos", "Chai Point", "Tea Trails", "Tim Hortons", "Dunkin", "Dunkin Donuts", "Mad Over Donuts", "Krispy Kreme",
  "Theobroma", "Le Pain Quotidien", "Keventers", "Café Delhi Heights", "Cafe Delhi Heights", "Big Chill", "Big Chill Cafe", "Hard Rock Cafe", "Subko", "Subko Coffee", "Subko Cafe",
  // Quick service & pizza
  "McDonald's", "McDonalds", "KFC", "Burger King", "Domino's", "Dominos", "Domino's Pizza", "Pizza Hut", "Papa John's", "La Pino'z", "La Pinoz Pizza", "Oven Story Pizza",
  "Subway", "Taco Bell", "Wendy's", "Carl's Jr.", "Popeyes", "Wow! Momo", "Wow Momo", "Burger Singh", "Faasos", "Behrouz Biryani", "Biryani By Kilo", "Bikkgane Biryani",
  "Paradise Biryani", "Haldiram", "Haldiram's", "Bikanervala", "Nirula's", "Nirulas", "Sagar Ratna", "Saravana Bhavan", "Hotel Saravana Bhavan", "Om Sweets",
  "Moti Mahal", "Moti Mahal Delux", "Karim's", "Goli Vada Pav", "Jumboking", "Chicking", "Rolls Mania", "Kathi Junction", "Box8", "EatFit",
  // Casual dining & bars
  "Barbeque Nation", "Absolute Barbecues", "AB's Absolute Barbecues", "Social", "Smoke House Deli", "Mainland China", "Yo! China", "Punjab Grill", "Pind Balluchi",
  "The Beer Cafe", "Beer Cafe", "Hoppipola", "Mamagoto", "Chili's", "TGI Friday's", "Copper Chimney", "Farzi Cafe", "Bombay Brasserie", "Castle's Barbeque",
  // Desserts & ice cream
  "Baskin Robbins", "Naturals", "Natural Ice Cream", "Giani's", "Gianis", "Kwality Walls", "Häagen-Dazs", "Haagen Dazs", "Monginis", "Bikano", "Cream Stone",
  // Retail, pharmacy, beauty & fitness
  "Reliance Fresh", "Reliance Smart", "Reliance Trends", "Reliance Digital", "DMart", "Big Bazaar", "More", "Spencer's", "Nature's Basket", "Lenskart", "Titan", "Tanishq",
  "Bata", "Croma", "Apollo Pharmacy", "MedPlus", "Wellness Forever", "Guardian Pharmacy", "Lakme Salon", "Lakmé Salon", "Naturals Salon", "Jawed Habib", "Toni & Guy",
  "Enrich Salon", "Looks Salon", "Geetanjali Salon", "Cult.fit", "Cult Fit", "Gold's Gym", "Anytime Fitness", "Snap Fitness", "Talwalkars",
];
