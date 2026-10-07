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
}

export enum Direction {
	ASC = 1,
	DESC = -1,
}

registerEnumType(Direction, {
	name: 'Direction',
});
