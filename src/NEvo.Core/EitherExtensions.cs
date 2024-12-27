namespace LanguageExt;

public static class EitherExtensions
{
    public static Either<TLeft, TRight> Do<TLeft, TRight>(
        this Either<TLeft, TRight> either,
        Action<TRight> Right,
        Action<TLeft> Left
    )
    {
        either.Match(Right, Left);
        return either;
    }
}
