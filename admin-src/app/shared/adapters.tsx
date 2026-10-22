import { SharedPartnerList, type SharedPartnerListProps } from './SharedPartnerList';
import { SharedInlinePartner, SharedPartnerPeople, SharedReferralPicker, type SharedInlinePartnerProps, type SharedPartnerPeopleProps, type SharedReferralPickerProps } from './PartnerForms';
export function ReferralPartners({shared}:{shared:SharedPartnerListProps}) {return <SharedPartnerList {...shared} />;}
export function InlinePartnerAdd({shared}:{shared:SharedInlinePartnerProps}) {return <SharedInlinePartner {...shared} />;}
export function PartnerPeople({shared}:{shared:SharedPartnerPeopleProps}) {return <SharedPartnerPeople {...shared} />;}
export function ReferralLink({shared}:{shared:SharedReferralPickerProps}) {return <SharedReferralPicker {...shared} />;}
