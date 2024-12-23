using NEvo.Messaging.Authorization;

namespace NEvo.Messaging.Context;

public static class MessageContextExtensions
{
    public static UserContext<TId> GetUserContext<TId>(this IMessageContext context)
    {
        return context.GetFeature<UserContext<TId>>();
    }
}