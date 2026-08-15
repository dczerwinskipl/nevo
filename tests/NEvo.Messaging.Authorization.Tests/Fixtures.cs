using LanguageExt;
using NEvo.Authorization;

namespace NEvo.Messaging.Authorization.Tests;

// Two distinct data scopes/validators (rather than one shared one) so tests can supply
// a user with one permission but not the other, proving message-level and
// handler-level requirements are enforced independently (AND), not interchangeably.
public record MessageLevelScope : AuthDataScope;
public record HandlerLevelScope : AuthDataScope;

// Grants access whenever the user holds any permission of the matching data-scope type
// — the tests control pass/fail entirely through which permissions a user has, not
// through validator logic.
public class AlwaysValidValidator<TDataScope> : IDataScopeMessageValidator<TDataScope, Message>
    where TDataScope : AuthDataScope
{
    public bool Validate(TDataScope dataScope, Message message) => true;
}

public record PlainCommand() : Message;

[AllowPermission("message-permission", typeof(AlwaysValidValidator<MessageLevelScope>))]
public record RequiresMessagePermissionCommand() : Message;

// Carries the handler-level [AllowPermission] a real IMessageHandler's
// HandlerDescription.Method would point at.
public class HandlerWithPermission
{
    [AllowPermission("handler-permission", typeof(AlwaysValidValidator<HandlerLevelScope>))]
    public Task<Either<Exception, object>> HandleAsync() => throw new NotImplementedException();
}
