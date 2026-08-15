using LanguageExt;
using Microsoft.Extensions.DependencyInjection;
using NEvo.Authorization.Users;
using NEvo.Core;
using NEvo.Messaging.Context;
using NEvo.Messaging.Handling;
using NEvo.Messaging.Handling.Middleware;

namespace NEvo.Messaging.Authorization;

public class ValidatePermissionMiddleware<TId, TUser>(IServiceProvider serviceProvider) : IMessageProcessingHandlerMiddleware where TUser : User<TId>
{
    // TODO: avoid using IServiceProvider?
    private readonly IServiceProvider _serviceProvider = Check.Null(serviceProvider);

    public Task<Either<Exception, object>> ExecuteAsync(IMessageHandler messageHandler, IMessage message, IMessageContext context, Func<Task<Either<Exception, object>>> next, CancellationToken cancellationToken)
    {
        // Message-level requirement (the message's own primary permission — always
        // present regardless of which route/Method was selected, unlike the
        // handler-level requirement below) and handler-level requirement (an explicit
        // handler's own additional permission, read from its Method as before) are
        // each independently required — AND, never one overriding the other.
        var messageLevelAttributes = message.GetType().GetCustomAttributes(typeof(AllowPermissionAttribute), true).OfType<AllowPermissionAttribute>();
        var handlerLevelAttributes = messageHandler.HandlerDescription.Method?.GetCustomAttributes(typeof(AllowPermissionAttribute), true).OfType<AllowPermissionAttribute>()
            ?? Enumerable.Empty<AllowPermissionAttribute>();

        if (!IsAuthorized(message, context, messageLevelAttributes) || !IsAuthorized(message, context, handlerLevelAttributes))
        {
            return Task.FromResult(Either<Exception, object>.Left(
                                new PermissionDeniedException()
                            ));
        }

        return next();
    }

    // An empty requirement set imposes no restriction (unchanged from before message-
    // level attributes existed); a non-empty set is satisfied if any one of its
    // attributes validates.
    private bool IsAuthorized(IMessage message, IMessageContext context, IEnumerable<AllowPermissionAttribute> allowPermissionAttributes)
    {
        var attributes = allowPermissionAttributes.ToList();
        return attributes.Count == 0 || IsValid(message, context, attributes);
    }

    private bool IsValid(IMessage message, IMessageContext context, IEnumerable<AllowPermissionAttribute> allowPermissionAttributes)
    {
        foreach (var allowPermissionAttribute in allowPermissionAttributes)
        {
            if (IsValid(message, context, allowPermissionAttribute))
            {
                return true;
            }
        }

        return false;
    }

    private bool IsValid(IMessage message, IMessageContext context, AllowPermissionAttribute allowPermissionAttribute)
    {
        var validator = (IDataScopeMessageValidator)ActivatorUtilities.CreateInstance(_serviceProvider, allowPermissionAttribute.ValidatorType);
        foreach (var userPermission in context.GetUserContext<TId, TUser>().UserPermissions)
        {
            if (validator.Validate(userPermission, message))
            {
                return true;
            }
        }
        return false;
    }
}

