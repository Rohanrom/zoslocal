import { redirect } from 'next/navigation';

// Hub address for Estimation. Estimates still live at /pre-contract-boq.
export default function EstimationHub() {
  redirect('/pre-contract-boq');
}
