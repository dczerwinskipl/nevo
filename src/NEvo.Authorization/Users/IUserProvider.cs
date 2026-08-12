namespace NEvo.Authorization.Users;

public interface IUserProvider<TUser, TId> where TUser : User<TId>
{
    public Option<TUser> GetUser();
}
