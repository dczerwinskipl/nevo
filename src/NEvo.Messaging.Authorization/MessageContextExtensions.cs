using NEvo.Authorization.Users;
using NEvo.Messaging.Authorization;

namespace NEvo.Messaging.Context;

public static class MessageContextExtensions
{
    public static UserContext<TId, TUser> GetUserContext<TId, TUser>(this IMessageContext context) where TUser : User<TId>
    {
        return context.GetFeature<UserContext<TId, TUser>>();
    }
}