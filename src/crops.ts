/** Crops ripen fruit that the basket holds; every other plant is grown for itself. */
export const TERRARIUM_CROP_SPECIES = ['tomato', 'strawberry', 'watermelon', 'melon', 'wheat'] as const;
export type CropSpecies = typeof TERRARIUM_CROP_SPECIES[number];
