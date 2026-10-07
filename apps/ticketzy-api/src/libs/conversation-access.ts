import { Message } from './enums/common.enum';
import { MemberStatus, MemberType } from './enums/member.enum';

/**
 * Organizers in these statuses are the "contact support" cases: they can only use the general support conversation.
 * (REJECTED and SUSPENDED cannot even log in, so they must be able to reach support to ask why.)
 */
export const supportOnlyOrganizerStatuses = [MemberStatus.PENDING, MemberStatus.REJECTED, MemberStatus.SUSPENDED];

interface AccessMember {
	_id: any;
	memberType: MemberType;
	memberStatus: MemberStatus;
}

interface AccessConversation {
	organizerId: any;
	isSupport?: boolean;
}

/** null when the member may read and write the conversation, otherwise the Message to answer with */
export const getConversationDenial = (member: AccessMember | null | undefined, conversation: AccessConversation): Message | null => {
	if (!member) return Message.NOT_AUTHENTICATED;

	if (member.memberType === MemberType.ADMIN) {
		return member.memberStatus === MemberStatus.ACTIVE ? null : Message.CONVERSATION_NOT_ALLOWED;
	}

	if (member.memberType !== MemberType.ORGANIZER) return Message.CONVERSATION_NOT_ALLOWED;
	if (String(member._id) !== String(conversation.organizerId)) return Message.CONVERSATION_NOT_ALLOWED;

	if (member.memberStatus === MemberStatus.ACTIVE) return null;
	if (supportOnlyOrganizerStatuses.includes(member.memberStatus)) {
		return conversation.isSupport ? null : Message.CONVERSATION_SUPPORT_ONLY;
	}
	return Message.CONVERSATION_NOT_ALLOWED;
};

/** can this member open a conversation about `eventId` (undefined = the general support one)? */
export const getStartDenial = (member: AccessMember | null | undefined, hasEvent: boolean): Message | null => {
	if (!member) return Message.NOT_AUTHENTICATED;
	if (member.memberType !== MemberType.ORGANIZER) return Message.CONVERSATION_ORGANIZERS_ONLY;
	if (member.memberStatus === MemberStatus.ACTIVE) return null;
	if (supportOnlyOrganizerStatuses.includes(member.memberStatus)) {
		return hasEvent ? Message.CONVERSATION_SUPPORT_ONLY : null;
	}
	return Message.CONVERSATION_NOT_ALLOWED;
};
