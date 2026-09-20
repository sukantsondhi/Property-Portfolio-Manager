import { app } from "@azure/functions";

app.setup({ enableHttpStream: true });

import "./functions/health";
import "./functions/me";
import "./functions/organizations";
import "./functions/dashboard";
import "./functions/records";
import "./functions/documents";
import "./functions/reminders";
import "./functions/rentalYears";
