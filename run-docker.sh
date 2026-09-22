VERSION=$npm_package_version

if test -z "$VERSION" ; then
    echo "must have npm_package_version env var"
    exit -1
fi

imagelabel="editii/biblioteca-vectorizer:$VERSION"
registry="mini.local:5000"
remoteimagelabel="$registry/$imagelabel"

echo "building $remoteimagelabel ..."

docker build -t "$imagelabel"  .
docker tag "$imagelabel" "$remoteimagelabel"
docker push "$remoteimagelabel"
