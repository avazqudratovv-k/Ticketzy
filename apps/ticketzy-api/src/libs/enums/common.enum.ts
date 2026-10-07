import { registerEnumType } from '@nestjs/graphql';

export enum Message {
	SOMETHING_WENT_WRONG = 'Something went wrong!',
	NO_DATA_FOUND = 'No data found!',
	CREATE_FAILED = 'Create failed!',
	UPDATE_FAILED = 'Update failed!',
	REMOVE_FAILED = 'Remove failed!',
	UPLOAD_FAILED = 'Upload failed!',
	BAD_REQUEST = 'Bad Request',

	USED_MEMBER_EMAIL_NICK_OR_PHONE = 'Already used member email, nick or phone',
	WRONG_EMAIL_OR_PASSWORD = 'Incorrect email or password!',
	ACCOUNT_NOT_VERIFIED = 'Your account was not verified. Please contact support.',
	ORGANIZER_NOT_APPROVED = 'Your organizer account is waiting for admin approval!',
	NOT_AUTHENTICATED = 'You are not authenticated, please login first!',
	TOKEN_NOT_EXIST = 'Bearer Token is not provided!',
	ONLY_SPECIFIC_ROLES_ALLOWED = 'Allowed only for members with specific role',
	NOT_ALLOWED_REQUEST = 'Not Allowed Request!',
	PROVIDE_ALLOWED_FORMAT = 'Please provide jpg, jpeg or png images!',
	SELF_SUBSCRIPTION_DENIED = 'Self subscription is denied!',
	ONLY_ORGANIZERS_CAN_BE_FOLLOWED = 'Only organizers can be followed!',
	NO_ORGANIZER_FOUND = 'No organizer found!',
	USE_ORGANIZER_OPERATIONS = 'Organizer status and role are changed with the organizer operations, not with updateMemberByAdmin!',
	INVALID_STATUS_TRANSITION = 'This organizer status change is not allowed from the current status!',
	REJECT_REASON_REQUIRED = 'A reason is required to reject an organizer!',
	SUSPEND_REASON_REQUIRED = 'A reason is required to suspend an organizer!',
	COMMISSION_REASON_REQUIRED = 'A reason is required to set a commission override!',
	INVALID_COMMISSION_RATE = 'The commission rate must be between 0 and 100!',
	INVALID_COMMISSION_END_DATE = 'The commission override end date must be in the future!',

	INVALID_EVENT_TRANSITION = 'This event status change is not allowed from the current status!',
	EVENT_NOT_EDITABLE = 'This event cannot be edited in its current status!',
	EVENT_REJECT_REASON_REQUIRED = 'A reason is required to reject an event!',
	EVENT_CANCEL_REASON_REQUIRED = 'A reason is required to cancel an event!',
	CANNOT_APPROVE_OWN_EVENT = 'Organizers cannot approve their own events!',
	EVENT_SUBMIT_TITLE_REQUIRED = 'The event needs a title before it can be submitted!',
	EVENT_SUBMIT_IMAGE_REQUIRED = 'The event needs at least one image before it can be submitted!',
	EVENT_SUBMIT_DATES_IN_PAST = 'The event start and end dates must be in the future to submit it!',
	EVENT_SUBMIT_VENUE_REQUIRED = 'The event needs an active venue before it can be submitted!',
	EVENT_SUBMIT_TICKET_TYPE_REQUIRED = 'The event needs at least one ticket type before it can be submitted!',

	INVALID_VENUE_LAYOUT = 'The venue layout is not valid!',
	VENUE_LAYOUT_NO_SECTIONS = 'The venue layout needs at least one section!',
	VENUE_LAYOUT_DUPLICATE_SECTION_KEY = 'Section keys in a venue layout must be unique!',
	VENUE_LAYOUT_BAD_SEAT_GRID = 'Rows and seats per row must be whole numbers between 1 and 100!',
	VENUE_LAYOUT_CAPACITY_REQUIRED = 'A standing section needs a capacity of at least 1!',
	VENUE_LAYOUT_TIER_KEY_REQUIRED = 'A seated section needs a tier key!',
	INVALID_VENUE_TIMEZONE = 'The venue timezone must be a valid IANA timezone!',
	EVENT_SUBMIT_LAYOUT_REQUIRED = 'A reserved-seating event needs a venue with a seated section before it can be submitted!',
	SEAT_TIER_MISSING = 'Every seated section needs a ticket type with a matching tier key!',
	SEAT_TIER_DUPLICATE = 'Only one ticket type of an event can use a tier key!',
	TICKET_TYPE_TIER_KEY_REQUIRED = 'A ticket type of a reserved-seating event needs a tier key that matches a seated section!',
	TICKET_TYPE_QUANTITY_FROM_SEATS = 'The quantity of a reserved-seating ticket type is computed from its seats and cannot be set!',
	TICKET_TYPE_QUANTITY_REQUIRED = 'A total quantity is required for this ticket type!',
	TICKET_TYPE_TIER_LOCKED = 'The tier key cannot change after the seats of the event were generated!',
	SEAT_GENERATION_FAILED = 'The seats of this event could not be generated, nothing was changed!',
}

export enum Direction {
	ASC = 1,
	DESC = -1,
}

registerEnumType(Direction, {
	name: 'Direction',
});
