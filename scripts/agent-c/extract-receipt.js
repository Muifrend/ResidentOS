#!/usr/bin/env node
import {
  extractReceiptFromImage,
  loadLocalEnv,
} from "../../integrations/nearai/receipt-extractor.js";

const imagePath = process.argv[2] || "/home/andrew/Downloads/IMG_3195.png";

loadLocalEnv();

extractReceiptFromImage({ imagePath })
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
