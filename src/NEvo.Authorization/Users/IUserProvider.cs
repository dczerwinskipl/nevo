namespace NEvo.Authorization.Users;

public interface IUserProvider<TId>
{
    public Option<User<TId>> GetUser();
}
